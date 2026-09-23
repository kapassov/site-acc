import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as items from '../src/lib/checkoutItems.ts';
import * as bodyReader from '../src/lib/httpBody.ts';
import * as identity from '../src/lib/daribar/customer-identity.ts';
import * as money from '../src/lib/money.ts';
import * as cities from '../src/lib/i18n/cities.ts';
import * as deliveryDetails from '../src/lib/checkout/delivery-details.ts';
import { StandardNCommerceError } from '../src/lib/standardn-commerce.ts';
import { CheckoutQuoteError } from '../src/lib/checkoutQuote.ts';
import { DaribarHttpError } from '../src/lib/daribar/client.ts';
import { DaribarCheckoutError } from '../src/lib/daribar/checkout.ts';
import { DaribarDeliveryError, deliveryDestinationHash } from '../src/lib/daribar/delivery.ts';
import { DaribarDeliveryClaimError } from '../src/lib/daribar/delivery-claim.ts';

const attemptId='12345678-1234-4123-8123-123456789abc';
const cartItems=[{productId:'prod_A1',variantId:'variant_V1',quantity:2}];
const quote=()=>({fulfillment:'pharmacy',quoteToken:'upstream-signed',snapshotId:'a'.repeat(64),
  subtotal:755.78,total:755.78,expiresAt:new Date(Date.now()+240000).toISOString(),
  pharmacy:{id:'sloc_A1',name:'Аптека',city:'Алматы',address:'Источник 1'},
  lines:[{...cartItems[0],wareId:'12345678-1234-1234-1234-123456789abc',unitPrice:377.89,total:755.78}]});

function fixture(options={}) {
  const calls=[];
  const signed=options.quote??quote();
  const order={id:'order_A1',display_id:1,created_at:new Date().toISOString(),total:signed.total,currency_code:'kzt',items:[],customer_id:'cus_native'};
  const modules={
    'node:crypto': awaitlessCrypto,
    'next/headers':{cookies:async()=>({get:name=>name==='daribar_access'&&!options.noAuth?{value:'verified-session'}:undefined,delete:()=>{}})},
    'next/server':{NextResponse:{json:(body,config)=>Response.json(body,config)}},
    '@/lib/rateLimit':{clientIp:()=> 'test',rateLimit:()=>true},
    '@/lib/httpBody':bodyReader,'@/lib/checkoutItems':items,'@/lib/money':money,'@/lib/i18n/cities':cities,
    '@/lib/checkout/delivery-details':deliveryDetails,
    '@/lib/checkoutQuote':{CheckoutQuoteError,verifyCheckoutQuote:()=> options.invalidQuote?null:signed},
    '@/lib/daribar/auth':{DARIBAR_ACCESS_COOKIE:'daribar_access',DARIBAR_REFRESH_COOKIE:'daribar_refresh',
      getDaribarUser:async()=>{calls.push(['auth']);return {phone:'77000000000'};},
      refreshDaribarAuth:async()=>{throw Error('unexpected refresh')},setDaribarAuthCookies:()=>{}},
    '@/lib/daribar/client':{DaribarHttpError},'@/lib/daribar/customer-identity':identity,
    '@/lib/daribar/checkout':{DaribarCheckoutError},
    '@/lib/daribar/quote-order':{createDaribarOrderForQuote:async input=>{if(!options.daribar)throw Error('unexpected Daribar order');calls.push(['daribar-order',input]);return {id:'DARIBAR-ORDER-1',status:'new',...(options.paymentUrl?{paymentUrl:options.paymentUrl}:{})};}},
    '@/lib/daribar/delivery':{DaribarDeliveryError,deliveryDestinationHash},
    '@/lib/daribar/delivery-claim':{DaribarDeliveryClaimError,createDaribarDeliveryClaim:async input=>{if(!options.daribar)throw Error('unexpected Daribar claim');calls.push(['daribar-claim',input]);if(options.claimError)throw options.claimError;return {provider:'yandex',id:'CLAIM-1',status:'ready_for_approval',price:signed.delivery?.price};}},
    '@/lib/daribar/config':{isDaribarEnabled:()=>Boolean(options.daribar),isDaribarDeliveryEnabled:()=>Boolean(options.daribar)},
    '@/lib/orders/store':{recordCompletedDaribarOrder:async input=>{if(!options.daribar)throw Error('unexpected Daribar persistence');calls.push(['persist-daribar',input]);return {id:'local-order-1',n:1,date:'today',sum:input.total,status:'Создан',items:2,delivery:'courier'};},updateStoredOrderMetadata:async(id,metadata)=>{calls.push(['metadata',id,metadata]);return {id,n:1,date:'today',sum:signed.total,status:'Создан',items:2,delivery:'courier'};},recordCompletedMedusaOrder:async input=>{calls.push(['persist',input]);return {id:order.id,n:1,date:'today',sum:signed.total,status:'Создан',items:2,delivery:'courier'};}},
    '@/lib/payments/kassa':{kassaEnabled:()=>true,createKassaPayment:async stored=>{calls.push(['payment',stored]);if(options.paymentError)throw Error('private-provider-detail');return {redirect:'https://pay.kassa.com/private-token'};}},
    '@/lib/standardn-commerce':{StandardNCommerceError,medusaCommerce:async(path,body)=>{calls.push(['medusa',path,body]);const error=typeof options.providerError==='function'?options.providerError():options.providerError;if(error)throw error;return {order};}},
    '@/lib/checkout-attempts':{
      beginCheckoutAttempt:async input=>{calls.push(['begin',input]);return options.attempt??{outcome:'started',attemptId};},
      markCheckoutProviderStarted:async id=>calls.push(['started',id]),
      completeCheckoutAttempt:async(id,data)=>calls.push(['complete',id,data]),
      releaseCheckoutAttempt:async id=>calls.push(['release',id]),
    },
  };
  const compiled=ts.transpileModule(readFileSync('src/app/api/checkout/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const loadedModule={exports:{}};
  new Function('require','module','exports',compiled)(name=>{assert.ok(name in modules,name);return modules[name]},loadedModule,loadedModule.exports);
  return {calls,POST:loadedModule.exports.POST};
}
import * as awaitlessCrypto from 'node:crypto';
const request=(extra={})=>new Request('https://shop.test/api/checkout',{method:'POST',headers:{'content-type':'application/json','x-idempotency-key':'test-checkout-1'},body:JSON.stringify({cartItems,quoteId:'signed',city:'Алматы',address:'Тест 1',delivery:'courier',payment:'cash',cartInstanceId:attemptId,phone:'77777777777',...extra})});
process.env.CUSTOMER_AUTH_SECRET='test-only-customer-secret-at-least-32-characters';

test('real SMS identity creates native Medusa order, preserving exact tiyn and account ownership',async()=>{
  const f=fixture(),response=await f.POST(request());assert.equal(response.status,201);
  const call=f.calls.find(c=>c[0]==='medusa');assert.equal(call[1],'/store/standardn/orders');
  assert.equal(call[2].customer.phone,'77000000000');assert.equal(call[2].idempotencyKey,attemptId);
  const saved=f.calls.find(c=>c[0]==='persist')[1];assert.match(saved.customerId,/^daribar:[a-f0-9]{64}$/);
  assert.equal(saved.metadata.provider,'medusa');assert.equal(saved.fallbackTotal,755.78);
  assert.ok(!f.calls.some(c=>c[0]==='payment'));
});
test('card creation returns opaque branded payment session, never Kassa URL',async()=>{
  const f=fixture(),response=await f.POST(request({payment:'card'}));assert.equal(response.status,202);
  const body=await response.json();assert.equal(body.amount,755.78);assert.equal(body.paymentSessionId,attemptId);
  assert.doesNotMatch(JSON.stringify(body),/https|private-token/);assert.ok(f.calls.some(c=>c[0]==='payment'));
});
test('pickup ignores forged address and sends signed pharmacy address',async()=>{
  const f=fixture({quote:{...quote(),fulfillment:'pickup'}}),response=await f.POST(request({delivery:'pickup',address:'FORGED'}));
  assert.equal(response.status,201);assert.equal(f.calls.find(c=>c[0]==='medusa')[2].address.address1,'Источник 1');
});
test('Daribar courier checkout creates both the commercial order and courier claim',async()=>{
  const destination='Тест 1';
  const signed={...quote(),delivery:{mode:'pharmacy',provider:'yandex',deliveryType:'on_demand',
    price:500,itemsPrice:755.78,orderItems:[{sku:'1234567890',countDesired:2,pharmacyCount:5}],
    eta:30,distance:2.5,daribarSourceCode:'pharmacy-1',pharmacyId:'sloc_A1',
    destinationHash:deliveryDestinationHash('Алматы',destination),quotedAt:new Date().toISOString()}};
  const f=fixture({daribar:true,quote:signed});
  const response=await f.POST(request({address:destination}));
  assert.equal(response.status,201);
  assert.ok(f.calls.some(c=>c[0]==='daribar-order'));
  assert.ok(f.calls.some(c=>c[0]==='daribar-claim'));
  assert.equal(f.calls.find(c=>c[0]==='persist-daribar')[1].total,1255.78);
  assert.equal(f.calls.find(c=>c[0]==='daribar-claim')[1].orderPrice,1255.78);
  assert.equal(f.calls.find(c=>c[0]==='metadata')[2].delivery_claim_status,'ready_for_approval');
  assert.ok(!f.calls.some(c=>c[0]==='medusa'));
});
test('failed courier claim does not hide an already-issued hosted payment link',async()=>{
  const destination='Тест 1';
  const signed={...quote(),delivery:{mode:'pharmacy',provider:'yandex',deliveryType:'on_demand',
    price:500,itemsPrice:755.78,orderItems:[{sku:'1234567890',countDesired:2,pharmacyCount:5}],
    eta:30,distance:2.5,daribarSourceCode:'pharmacy-1',pharmacyId:'sloc_A1',
    destinationHash:deliveryDestinationHash('Алматы',destination),quotedAt:new Date().toISOString()}};
  const f=fixture({daribar:true,quote:signed,paymentUrl:'https://pay.daribar.kz/session',
    claimError:new DaribarDeliveryClaimError(502,'delivery_claim_unavailable')});
  const response=await f.POST(request({address:destination,payment:'card'}));
  assert.equal(response.status,202);
  const body=await response.json();
  assert.equal(body.paymentSessionId,attemptId);
  assert.doesNotMatch(JSON.stringify(body),/https|private-token/);
  assert.equal(f.calls.find(c=>c[0]==='complete')[2].state,'replay');
  assert.equal(f.calls.findLast(c=>c[0]==='metadata')[2].delivery_claim_status,'failed');
  assert.equal(f.calls.findLast(c=>c[0]==='metadata')[2].checkout_state,'awaiting_payment');
  assert.ok(!f.calls.some(c=>c[0]==='payment'));
  assert.ok(!f.calls.some(c=>c[0]==='release'));
});
test('missing Daribar payment link fails before courier booking and is replay-safe',async()=>{
  const destination='Тест 1';
  const signed={...quote(),delivery:{mode:'pharmacy',provider:'yandex',deliveryType:'on_demand',
    price:500,itemsPrice:755.78,orderItems:[{sku:'1234567890',countDesired:2,pharmacyCount:5}],
    eta:30,distance:2.5,daribarSourceCode:'pharmacy-1',pharmacyId:'sloc_A1',
    destinationHash:deliveryDestinationHash('Алматы',destination),quotedAt:new Date().toISOString()}};
  const f=fixture({daribar:true,quote:signed});
  const response=await f.POST(request({address:destination,payment:'card'}));
  assert.equal(response.status,502);
  assert.equal((await response.json()).error,'payment_link_unavailable');
  assert.ok(!f.calls.some(c=>c[0]==='daribar-claim'));
  assert.equal(f.calls.find(c=>c[0]==='complete')[2].state,'replay');
});
test('cash checkout still fails closed when courier booking fails',async()=>{
  const destination='Тест 1';
  const signed={...quote(),delivery:{mode:'pharmacy',provider:'yandex',deliveryType:'on_demand',
    price:500,itemsPrice:755.78,orderItems:[{sku:'1234567890',countDesired:2,pharmacyCount:5}],
    eta:30,distance:2.5,daribarSourceCode:'pharmacy-1',pharmacyId:'sloc_A1',
    destinationHash:deliveryDestinationHash('Алматы',destination),quotedAt:new Date().toISOString()}};
  const f=fixture({daribar:true,quote:signed,
    claimError:new DaribarDeliveryClaimError(502,'delivery_claim_unavailable')});
  const response=await f.POST(request({address:destination,payment:'cash'}));
  assert.equal(response.status,502);
  assert.equal((await response.json()).error,'delivery_booking_failed');
  assert.equal(f.calls.find(c=>c[0]==='complete')[2].state,'replay');
});
for(const [name,options,extra,status] of [
  ['missing cash selection',{}, {payment:undefined},400],
  ['missing delivery selection',{}, {delivery:undefined},400],
  ['missing authentication',{noAuth:true},{},401],['expired quote',{invalidQuote:true},{},409],
  ['cross-city quote',{}, {city:'Астана'},409],['wrong fulfillment',{}, {delivery:'pickup'},409],
  ['old Daribar cart',{}, {cartItems:[{productId:'prod_DaribarABC12345',variantId:'variant_DaribarABC12345',quantity:1}]},409],
  ['unimplemented promo',{}, {promoCode:'FAKE'},409],
])test(name+' never creates or reserves an order',async()=>{const f=fixture(options),response=await f.POST(request(extra));assert.equal(response.status,status);assert.ok(!f.calls.some(c=>c[0]==='medusa'));});
test('localized city labels match canonical signed city',async()=>{const f=fixture();assert.equal((await f.POST(request({city:'Almaty'}))).status,201);});
for(const code of ['order_in_progress','order_total_reconciliation_required','order_recovery_required'])test(code+' stays uncertain, preserving durable key against duplicates',async()=>{
  const f=fixture({providerError:new StandardNCommerceError(409,code)}),response=await f.POST(request());assert.equal(response.status,502);
  assert.equal((await response.json()).error,'order_status_uncertain');assert.ok(!f.calls.some(c=>c[0]==='release'));
  assert.equal(f.calls.find(c=>c[0]==='complete')[2].state,'uncertain');
});
test('known pre-order insufficient stock releases attempt for a corrected cart',async()=>{const f=fixture({providerError:new StandardNCommerceError(409,'insufficient_stock')});assert.equal((await f.POST(request())).status,409);assert.ok(f.calls.some(c=>c[0]==='release'));});
for(const code of ['source_import_reconciliation_required','validated_snapshot_unavailable','site_channel_not_configured','kzt_region_ambiguous'])test(code+' 503 guard releases safely and the same cart can retry after recovery',async()=>{
  // medusaCommerce translates upstream503 to502 while retaining the named code.
  let providerCalls=0;
  const f=fixture({providerError:()=>providerCalls++===0?new StandardNCommerceError(502,code):null});
  const first=await f.POST(request());assert.equal(first.status,502);assert.equal((await first.json()).error,code);
  assert.equal(f.calls.filter(c=>c[0]==='release').length,1);
  assert.ok(!f.calls.some(c=>c[0]==='complete'||c[0]==='persist'||c[0]==='payment'));
  const second=await f.POST(request());assert.equal(second.status,201);
  assert.equal(f.calls.filter(c=>c[0]==='persist').length,1);
  assert.equal(f.calls.filter(c=>c[0]==='complete').length,1);
  assert.equal(f.calls.find(c=>c[0]==='complete')[2].state,'replay');
});
for(const [status,code] of [[502,'medusa_commerce_unavailable'],[503,'commerce_temporarily_unavailable'],[502,'unknown_backend_failure']])test('unknown '+status+' '+code+' never releases a possibly created order',async()=>{
  const f=fixture({providerError:new StandardNCommerceError(status,code)}),response=await f.POST(request());
  assert.equal(response.status,502);assert.equal((await response.json()).error,'order_status_uncertain');
  assert.ok(!f.calls.some(c=>c[0]==='release'));
  assert.equal(f.calls.find(c=>c[0]==='complete')[2].state,'uncertain');
});
test('payment failure after Medusa creation cannot recreate order automatically',async()=>{const f=fixture({paymentError:true});const r=await f.POST(request({payment:'card'}));assert.equal(r.status,502);assert.equal((await r.json()).orderCreated,true);assert.ok(!f.calls.some(c=>c[0]==='release'));});
test('durable replay does not contact Medusa a second time',async()=>{const f=fixture({attempt:{outcome:'replay',response:{status:201,payload:{order:{id:'order_A1'}}}}});assert.equal((await f.POST(request())).status,201);assert.ok(!f.calls.some(c=>c[0]==='medusa'));});
test('KZT helper preserves source cents and rejects genuine fractional tiyn',()=>{
  for(const [value,expected] of [[8631.68,863168],[13843.99,1384399],[1068.42,106842],[1430.54,143054],[377.89,37789],[0.1+0.2,30]])assert.equal(money.kztMinorUnits(value),expected);
  for(const value of [0.001,NaN,Infinity,-1,'10.20'])assert.equal(money.kztMinorUnits(value),null);
});
