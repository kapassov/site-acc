import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {StandardNCommerceError,validStandardNQuote} from '../src/lib/standardn-commerce.ts';
import {parseKassaNotification} from '../src/lib/payments/kassaContract.ts';

function fixture(fail=false){
  const queries=[],posts=[];
  const db={query:async(sql,params)=>{queries.push([sql,params]);return /RETURNING event_id/.test(sql)?{rows:[{event_id:'a'.repeat(64),order_id:'order_A1',transaction_id:'tx123',payment_state:'paid',amount:'377.89',currency:'KZT',attempts:1}]}:{rows:[]};}};
  const modules={'@/lib/orders/store':{ordersDatabasePool:async()=>db},'@/lib/standardn-commerce':{StandardNCommerceError,medusaCommerce:async(path,body)=>{posts.push([path,body]);if(fail)throw new StandardNCommerceError(502,'medusa_commerce_unavailable');return {ok:true};}}};
  const code=ts.transpileModule(readFileSync('src/lib/payments/medusa-sync.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const loadedModule={exports:{}};new Function('require','module','exports',code)(name=>modules[name],loadedModule,loadedModule.exports);
  return {...loadedModule.exports,db,queries,posts};
}
test('payment queue only accepts final verified states and Medusa-owned site orders',async()=>{
  const f=fixture();await f.queueMedusaPayment(f.db,{eventId:'a',orderId:'order_A1',transactionId:'tx',state:'pending',amount:377.89});assert.equal(f.queries.length,0);
  await f.queueMedusaPayment(f.db,{eventId:'a',orderId:'order_A1',transactionId:'tx',state:'paid',amount:377.89});
  assert.match(f.queries[0][0],/source_system='medusa'/);assert.match(f.queries[0][0],/ON CONFLICT \(event_id\) DO NOTHING/);assert.equal(f.queries[0][1][4],377.89);
});
test('durable sync retains exact amount, order, verified event identity',async()=>{
  const f=fixture();assert.deepEqual(await f.flushMedusaPaymentSync(),{sent:1,failed:0});
  assert.equal(f.posts[0][0],'/store/standardn/payment');assert.deepEqual(f.posts[0][1],{orderId:'order_A1',transactionId:'tx123',state:'paid',amount:377.89,currency:'KZT',idempotencyKey:'a'.repeat(64)});
  assert.match(f.queries[0][0],/FOR UPDATE SKIP LOCKED/);assert.match(f.queries[1][0],/status='sent'/);
});
test('temporary payment sync failure stays queued without charging or marking paid',async()=>{
  const f=fixture(true);assert.deepEqual(await f.flushMedusaPaymentSync(),{sent:0,failed:1});assert.equal(f.posts.length,1);
  assert.match(f.queries[1][0],/available_at=/);assert.equal(f.queries[1][1][1],'medusa_commerce_unavailable');assert.ok(!f.queries.some(([sql])=>/status='sent'/.test(sql)));
});
test('payment delivery uses enqueue sequence rather than transaction timestamps or event hashes',async()=>{
  const f=fixture();await f.flushMedusaPaymentSync();
  const claim=f.queries[0][0];
  assert.match(claim,/earlier\.event_sequence\s*<\s*candidate\.event_sequence/);
  assert.match(claim,/ORDER BY candidate\.event_sequence/);
  assert.doesNotMatch(claim,/created_at/);
  // Earlier pending events still block later ones while delayed/leased. Their
  // retry availability must not permit a refund to overtake its payment.
  const guard=claim.slice(claim.indexOf('AND NOT EXISTS'),claim.indexOf('ORDER BY candidate.event_sequence'));
  assert.match(guard,/earlier\.status='pending'/);
  assert.doesNotMatch(guard,/earlier\.(?:available_at|locked_until)/);
});
test('sequence migration is additive and refuses ambiguous legacy pending order',()=>{
  const migration=readFileSync('db/migrations/019_medusa_payment_event_sequence.sql','utf8');
  assert.match(migration,/ADD COLUMN IF NOT EXISTS event_sequence bigserial/i);
  assert.match(migration,/CREATE UNIQUE INDEX IF NOT EXISTS medusa_payment_sync_event_sequence_uq/);
  assert.match(migration,/status = 'pending'/);
  assert.match(migration,/RAISE EXCEPTION 'medusa_payment_pending_events_require_reconciliation/);
  assert.doesNotMatch(migration,/\b(?:DELETE|TRUNCATE)\b/i);
  const regression=readFileSync('tests/sql/medusa-payment-event-sequence.sql','utf8');
  assert.match(regression,/CREATE TEMP TABLE regression_payment_sequence/);
  assert.match(regression,/regression_fixture_must_reproduce_old_timestamp_inversion/);
  assert.match(regression,/refund_must_become_next_after_paid_ack/);
  assert.match(regression,/ROLLBACK;/);
});
test('Kassa callbacks accept tiyn but reject fractional tiyn',()=>{
  const value={id:'p1',token:'provider-token',status:'successful',notification_type:'pay',order:{amount:377.89,currency:'KZT'}};
  // Use an actual supported notification kind from the existing contract.
  value.notification_type='check';
  const source=readFileSync('src/lib/payments/kassaContract.ts','utf8');
  const kind=source.match(/KNOWN_NOTIFICATION_TYPES = new Set\(\[\s*["']([^"']+)/)?.[1];
  assert.ok(kind);value.notification_type=kind;
  assert.equal(parseKassaNotification(value).order.amount,377.89);
  assert.throws(()=>parseKassaNotification({...value,order:{amount:377.891,currency:'KZT'}}));
});
test('signed quote validation calculates line totals using integer tiyn',()=>{
  const items=[{productId:'prod_A1',variantId:'variant_V1',quantity:3}];
  const q={quoteToken:'valid-signed-quote-token',snapshotId:'b'.repeat(64),expiresAt:new Date(Date.now()+120000).toISOString(),currency:'KZT',subtotal:1133.67,total:1133.67,pharmacy:{id:'sloc_A1',name:'Аптека',city:'Алматы'},lines:[{...items[0],wareId:'12345678-1234-1234-1234-123456789abc',availableQuantity:3,unitPrice:377.89,total:1133.67}],adjustments:[]};
  assert.equal(validStandardNQuote(q,items),true);q.lines[0].unitPrice=377.891;assert.equal(validStandardNQuote(q,items),false);
});
