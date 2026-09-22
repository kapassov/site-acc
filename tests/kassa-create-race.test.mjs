import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as crypto from 'node:crypto';
import ts from 'typescript';
import * as contract from '../src/lib/payments/kassaContract.ts';

const env={KASSA_ENABLED:'true',KASSA_API_KEY:'test@example.test:abcdefghijklmnopqrstuv',
  KASSA_NOTIFICATION_API_KEY:'test-notification-secret',KASSA_PROJECT_ID:'1',
  KASSA_RETURN_SECRET:'test-only-return-secret-at-least-32-characters',
  KASSA_HOST:'https://api.kassa.test',KASSA_PUBLIC_ORIGIN:'https://shop.test',KASSA_TEST_MODE:'true'};
const responseData={id:'payment_1',token:'provider-token-1',payment_url:'https://pay.kassa.test/session1',
  status:'init',order:{amount:377.89,currency:'KZT'}};

function fixture(callbackPatch){
  const row={order_id:'order_A1',partner_payment_id:'ass-order_A1',status:'creating',
    provider_payment_id:null,provider_token:null,payment_url:null};
  const queries=[];let networkCalls=0,beforeSave;
  const db={query:async(sql,params)=>{
    queries.push(sql);
    if(/INSERT INTO kassa_payments/.test(sql))return {rows:[{...row}]};
    assert.match(sql,/UPDATE kassa_payments/);
    // Check the real SQL's concurrency contract; emulate that atomic update.
    assert.match(sql,/status = CASE WHEN status = 'creating' THEN \$5 ELSE status END/);
    assert.match(sql,/provider_payment_id IS NULL OR provider_payment_id = \$2/);
    assert.match(sql,/provider_token IS NULL OR provider_token = \$3/);
    assert.match(sql,/payment_url IS NULL OR payment_url = \$4/);
    const [orderId,id,token,url,status]=params;
    if(row.order_id!==orderId || (row.provider_payment_id!==null&&row.provider_payment_id!==id)
      || (row.provider_token!==null&&row.provider_token!==token)
      || (row.payment_url!==null&&row.payment_url!==url))return {rowCount:0};
    row.provider_payment_id??=id;row.provider_token??=token;row.payment_url??=url;
    if(row.status==='creating')row.status=status;
    return {rowCount:1};
  }};
  const modules={'node:crypto':crypto,'@/lib/orders/store':{ordersDatabasePool:async()=>db},
    './kassaContract':contract,'./medusa-sync':{queueMedusaPayment:async()=>{throw Error('unexpected callback send')},flushMedusaPaymentSync:async()=>({sent:0,failed:0})}};
  const source=ts.transpileModule(readFileSync('src/lib/payments/kassa.ts','utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const loadedModule={exports:{}};
  new Function('require','module','exports',source)(name=>{assert.ok(name in modules,name);return modules[name]},loadedModule,loadedModule.exports);
  const request=async()=>{
    networkCalls++;
    // A cryptographically verified callback has committed while the provider's
    // create HTTP response is still in flight. No external service is contacted.
    if(callbackPatch)Object.assign(row,callbackPatch);
    beforeSave={...row};
    return Response.json(responseData);
  };
  return {row,queries,run:()=>loadedModule.exports.createKassaPayment({id:'order_A1',n:1,sum:377.89,demo:false},env,request),
    get beforeSave(){return beforeSave},get networkCalls(){return networkCalls}};
}

test('initial Kassa create still stores the provider binding and URL',async()=>{
  const f=fixture(),result=await f.run();assert.equal(result.redirect,responseData.payment_url);
  assert.equal(f.row.status,'init');assert.equal(f.row.provider_payment_id,responseData.id);
  assert.equal(f.row.provider_token,responseData.token);assert.equal(f.networkCalls,1);
});
for(const status of ['init','successful','canceled','refund'])test('create response preserves earlier verified callback state '+status,async()=>{
  const f=fixture({status,provider_payment_id:responseData.id,provider_token:responseData.token});
  const result=await f.run();assert.equal(result.redirect,responseData.payment_url);
  assert.equal(f.row.status,status);assert.equal(f.row.payment_url,responseData.payment_url);
  assert.equal(f.row.provider_payment_id,responseData.id);assert.equal(f.networkCalls,1);
});
for(const patch of [{provider_payment_id:'different-payment'},{provider_token:'different-token'},
  {payment_url:'https://pay.kassa.test/different-session'}])test('create never overwrites a different existing provider binding '+Object.keys(patch)[0],async()=>{
  const f=fixture({status:'successful',provider_payment_id:responseData.id,provider_token:responseData.token,...patch});
  await assert.rejects(()=>f.run(),/kassa_payment_state_conflict/);
  assert.deepEqual(f.row,f.beforeSave);assert.equal(f.networkCalls,1);
});
