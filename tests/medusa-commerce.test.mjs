import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { commerceBaseUrl, commerceSignature, medusaCommerce, validStandardNQuote } from '../src/lib/standardn-commerce.ts';
import { createCheckoutQuote, createCourierAnchorQuote, verifyCheckoutQuote } from '../src/lib/checkoutQuote.ts';
import { validMedusaCartItem, boundedCartQuantity } from '../src/lib/cart/medusa-cart.ts';
import { daribarProductId, daribarVariantId } from '../src/lib/daribar/ids.ts';

const items = [{ productId:'prod_A1',variantId:'variant_V1',quantity:2 }];
const fixture = () => ({ quoteToken:'signed-upstream-quote-token',snapshotId:'a'.repeat(64),expiresAt:new Date(Date.now()+240000).toISOString(),currency:'KZT',subtotal:400,total:400,pharmacy:{id:'sloc_A1',name:'Аптека',city:'Алматы',address:'Адрес'},lines:[{...items[0],wareId:'12345678-1234-1234-1234-123456789abc',availableQuantity:3,unitPrice:200,total:400}],adjustments:[] });

test('commerce transport requires HTTPS or a loopback SSH tunnel', () => {
  assert.equal(commerceBaseUrl({MEDUSA_COMMERCE_URL:'http://127.0.0.1:19000'}),'http://127.0.0.1:19000');
  assert.equal(commerceBaseUrl({MEDUSA_COMMERCE_URL:'https://medusa.example.test'}),'https://medusa.example.test');
  for(const url of ['http://78.140.246.238:9000','https://user:pass@host.test','https://host.test/path','https://host.test/?token=1','file:///etc/passwd']) assert.throws(()=>commerceBaseUrl({MEDUSA_COMMERCE_URL:url}));
});
test('HMAC binds raw bytes, nonce, timestamp, method and route', () => {
  const sign = (body,path='/store/standardn/quote',nonce='n1',stamp='1') => commerceSignature('s'.repeat(32),stamp,nonce,path,body);
  const signature=sign('{"items":[]}');
  assert.equal(signature.length,64);
  assert.notEqual(signature,sign('{ "items": [] }'));
  assert.notEqual(signature,sign('{"items":[]}','/store/standardn/orders'));
  assert.notEqual(signature,sign('{"items":[]}',undefined,'n2'));
  assert.notEqual(signature,sign('{"items":[]}',undefined,undefined,'2'));
});
test('bridge POST signs exact transmitted body and never follows redirects', async () => {
  const env={MEDUSA_COMMERCE_URL:'http://127.0.0.1:19000',MEDUSA_COMMERCE_SECRET:'x'.repeat(40)};
  await medusaCommerce('/store/standardn/quote',{items},async (url,options)=>{
    assert.equal(url,'http://127.0.0.1:19000/store/standardn/quote');
    assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
    const h=options.headers;
    assert.equal(h['x-inkar-signature'],commerceSignature(env.MEDUSA_COMMERCE_SECRET,h['x-inkar-timestamp'],h['x-inkar-nonce'],'/store/standardn/quote',options.body));
    return Response.json({ok:true});
  },env);
});
test('bridge sanitizes network, malformed and internal error responses', async()=>{
  const env={MEDUSA_COMMERCE_URL:'http://localhost:19000',MEDUSA_COMMERCE_SECRET:'x'.repeat(40)};
  await assert.rejects(medusaCommerce('/store/standardn/quote',{},async()=>{throw Error('private database url')},env),{message:'medusa_commerce_unavailable'});
  await assert.rejects(medusaCommerce('/store/standardn/quote',{},async()=>new Response('bad'),env),{message:'medusa_commerce_invalid_response'});
  await assert.rejects(medusaCommerce('/store/standardn/quote',{},async()=>Response.json({error:'SELECT private token'},{status:500}),env),{message:'medusa_commerce_failed'});
});
test('quote validates every identity, available quantity, price, currency and expiry',()=>{
  assert.equal(validStandardNQuote(fixture(),items),true);
  const mutations=[q=>q.total=399,q=>q.currency='USD',q=>q.expiresAt=new Date(0).toISOString(),q=>q.lines[0].availableQuantity=1,q=>q.lines[0].unitPrice=0,q=>q.lines[0].productId='prod_B2',q=>q.lines[0].quantity=3,q=>q.lines[0].wareId='bad',q=>q.lines.push({...q.lines[0]}),q=>q.pharmacy.id='daribar-shop'];
  for(const mutate of mutations){const q=fixture();mutate(q);assert.equal(validStandardNQuote(q,items),false);}
});
test('signed checkout quote cannot be altered or replayed and binds its native provider',async()=>{
  const previous={fetch:globalThis.fetch,secret:process.env.CHECKOUT_QUOTE_SECRET,url:process.env.MEDUSA_COMMERCE_URL,bridge:process.env.MEDUSA_COMMERCE_SECRET};
  process.env.CHECKOUT_QUOTE_SECRET='q'.repeat(48);process.env.MEDUSA_COMMERCE_URL='http://127.0.0.1:19000';process.env.MEDUSA_COMMERCE_SECRET='s'.repeat(48);
  const dependencies={requestStockQuote:async()=>fixture(),requestStockQuotes:async()=>[{quote:fixture(),pharmacy:{id:'sloc_A1',sourceCode:'ass-1',name:'Аптека',city:'Алматы',address:'Адрес'}}]};
  try {
    const q=await createCheckoutQuote({items,fulfillment:'pickup',preferredPharmacy:{city:'Алматы'}},dependencies);
    assert.equal(q.source,'medusa');assert.equal(verifyCheckoutQuote(q.id,items).version,4);
    assert.equal(verifyCheckoutQuote(q.id,[{...items[0],quantity:1}]),null);
    assert.equal(verifyCheckoutQuote(q.id+'.extra',items),null);
    const payload=JSON.parse(Buffer.from(q.id.split('.')[0],'base64url'));
    payload.total=1;
    assert.equal(verifyCheckoutQuote(Buffer.from(JSON.stringify(payload)).toString('base64url')+'.'+q.id.split('.')[1],items),null);
    payload.version=2;const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
    assert.equal(verifyCheckoutQuote(encoded+'.'+createHmac('sha256',process.env.CHECKOUT_QUOTE_SECRET).update(encoded).digest('base64url'),items),null);
    const sku='SKU-NATIVE-1';
    const nativeItems=[{productId:daribarProductId(sku),variantId:daribarVariantId(sku),quantity:1}];
    const nativeQuote={...fixture(),subtotal:250,total:250,lines:[{...nativeItems[0],wareId:sku,availableQuantity:2,unitPrice:250,total:250}]};
    const native=await createCheckoutQuote({items:nativeItems,fulfillment:'pickup'},
      {requestStockQuote:async()=>nativeQuote,requestStockQuotes:async()=>[]});
    assert.equal(native.source,'daribar');
    assert.equal(verifyCheckoutQuote(native.id,nativeItems)?.source,'daribar');
    assert.equal(verifyCheckoutQuote(native.id,items),null);
  } finally {
    globalThis.fetch=previous.fetch;
    for(const [key,value] of [['CHECKOUT_QUOTE_SECRET',previous.secret],['MEDUSA_COMMERCE_URL',previous.url],['MEDUSA_COMMERCE_SECRET',previous.bridge]]) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
});
test('courier price and stock anchor keeps Medusa identity while using live Daribar stock',async()=>{
  const previous={fetch:globalThis.fetch,secret:process.env.CHECKOUT_QUOTE_SECRET,url:process.env.MEDUSA_COMMERCE_URL,
    bridge:process.env.MEDUSA_COMMERCE_SECRET,daribar:process.env.DARIBAR_ENABLED,delivery:process.env.DARIBAR_DELIVERY_ENABLED};
  process.env.CHECKOUT_QUOTE_SECRET='q'.repeat(48);process.env.MEDUSA_COMMERCE_URL='http://127.0.0.1:19000';
  process.env.MEDUSA_COMMERCE_SECRET='s'.repeat(48);process.env.DARIBAR_ENABLED='true';process.env.DARIBAR_DELIVERY_ENABLED='true';
  const seen=[];
  const dependencies={requestStockQuote:async input=>{seen.push(input);return fixture();},requestStockQuotes:async()=>[]};
  try {
    const result=await createCourierAnchorQuote({items,city:' Алматы '},dependencies);
    assert.equal(result.source,'medusa');
    assert.equal(result.pharmacy.id,'sloc_A1');
    assert.deepEqual(seen,[{items,city:'Алматы',preferredPharmacyId:undefined}]);
  } finally {
    globalThis.fetch=previous.fetch;
    for(const [key,value] of [['CHECKOUT_QUOTE_SECRET',previous.secret],['MEDUSA_COMMERCE_URL',previous.url],
      ['MEDUSA_COMMERCE_SECRET',previous.bridge],['DARIBAR_ENABLED',previous.daribar],['DARIBAR_DELIVERY_ENABLED',previous.delivery]]) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
});
test('cart accepts only valid native Medusa identities and bounded quantities',()=>{
  assert.equal(validMedusaCartItem({product:{id:'prod_A1',variantId:'variant_V1',source:'medusa'},qty:1}),true);
  for(const product of [{id:'prod_A1',variantId:'variant_V1',source:'daribar'},{id:'prod_Daribarabc12345',variantId:'variant_Daribarabc12345',source:'medusa'}])assert.equal(validMedusaCartItem({product,qty:1}),false);
  for(const qty of [0,100,NaN,1.2])assert.equal(validMedusaCartItem({product:{id:'prod_A1',variantId:'variant_V1',source:'medusa'},qty}),false);
  assert.equal(boundedCartQuantity(100),99);
});
test('checkout retains real Daribar SMS identity and keeps an atomic Medusa rollback path',async()=>{
  const route=await readFile(new URL('../src/app/api/checkout/route.ts',import.meta.url),'utf8');
  assert.match(route,/getDaribarUser\(access\)/);assert.match(route,/phone: profile.phone/);
  assert.match(route,/\/store\/standardn\/orders/);assert.match(route,/idempotencyKey: durableAttemptId/);
  assert.match(route,/recordCompletedMedusaOrder/);assert.match(route,/createKassaPayment\(stored\)/);
  assert.match(route,/createDaribarOrderForQuote/);assert.match(route,/recordCompletedDaribarOrder/);
  assert.doesNotMatch(route,/readDemoSession|recordCompletedStorefrontOrder/);
  assert.match(route,/publicPaymentSessionPayload/);assert.match(route,/markCheckoutProviderStarted/);
});
