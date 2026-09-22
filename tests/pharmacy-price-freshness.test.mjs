import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { exactKzt } from '../src/lib/money.ts';
import { isPharmacyStock, pharmacyCoordinate } from '../src/lib/pharmacy-stock.ts';
import { normalizeMedusaPharmacies } from '../src/lib/medusa-pharmacies.ts';
import { cachedPrice, priceCacheEntry, rememberPrice } from '../src/lib/price/cache.ts';

const stock = { sourceCode:'sloc_A1',name:'Аптека',city:'Алматы',quantity:3,price:187.53 };
test('pharmacy availability accepts exact positive tiyn, never fractional packs or invalid money',()=>{
  for(const price of [187.53,755.78,1,0.01]) assert.equal(isPharmacyStock({...stock,price}),true);
  assert.equal(isPharmacyStock(({...stock,price:undefined})),true);
  for(const price of [0,-1,NaN,Infinity,187.531,'187.53',null]) assert.equal(isPharmacyStock({...stock,price}),false);
  for(const quantity of [0,-1,1.33333333333333,NaN,Infinity,'3']) assert.equal(isPharmacyStock({...stock,quantity}),false);
  const ui=readFileSync('src/components/product/PharmacyAvailability.tsx','utf8');
  assert.match(ui,/pharmacies\.filter\(isPharmacyStock\)/);
  assert.doesNotMatch(ui,/Number\.isSafeInteger\(row\.price\)/);
});
test('unknown pharmacy coordinates stay absent, actual zero and valid signed coordinates are preserved',()=>{
  for(const value of [null,undefined,'',' ',true,false,{},[],NaN,Infinity,'unknown']) assert.equal(pharmacyCoordinate(value,90),undefined);
  assert.equal(pharmacyCoordinate(0,90),0);assert.equal(pharmacyCoordinate('43.25',90),43.25);
  assert.equal(pharmacyCoordinate(-90,90),-90);assert.equal(pharmacyCoordinate(91,90),undefined);
  assert.equal(pharmacyCoordinate(-180,180),-180);assert.equal(pharmacyCoordinate(181,180),undefined);
  const rows=normalizeMedusaPharmacies({pharmacies:[{id:'sloc_A1',lat:null,lon:null},{id:'sloc_A2',lat:'',lon:true},{id:'sloc_A3',lat:91,lon:181}]});
  assert.ok(rows.every(row=>row.lat===undefined&&row.lon===undefined));
});

// Execute the actual pharmacy-price function, isolating only its transport and
// clock. The same payload models a memory-cache hit immediately after expiry.
function priceFixture(payload, now) {
  const source=readFileSync('src/lib/medusa.ts','utf8');
  const start=source.indexOf('export async function getPharmacyPrices(');
  const end=source.indexOf('/** Fail-closed ownership check',start);
  assert.ok(start>0&&end>start);
  const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const loadedModule={exports:{}},calls=[];
  class Clock extends Date { static now(){return now.value;} }
  new Function('exports','MEDUSA_ON','mfetch','exactKzt','pharmacyCoordinate','cityFromName','Date',code)(
    loadedModule.exports,true,async(...args)=>{calls.push(args);return payload;},exactKzt,pharmacyCoordinate,()=>'',Clock);
  return {...loadedModule.exports,calls};
}
const deadline=Date.parse('2026-09-07T19:00:00Z');
const snapshot=()=>({complete:true,stale:false,data_state:'complete_snapshot',valid_until:new Date(deadline).toISOString(),
  pharmacies:[{id:'sloc_A1',name:'Аптека',city:'Алматы',price:187.53,available_quantity:1.33333333333333,quantity:2,
    in_stock:true,lat:null,lon:null}],snapshot_id:'verified',source_date:'2026-09-06'});
test('cached Medusa prices fail closed at valid_until even within the 60-second transport cache',async()=>{
  const now={value:deadline-1},f=priceFixture(snapshot(),now);
  const info=await f.getPharmacyPrices('prod_A1');
  assert.equal(info.min,187.53);assert.equal(info.validUntil,new Date(deadline).toISOString());
  assert.equal(info.pharmacies[0].availableQuantity,1.33333333333333);
  assert.equal(info.pharmacies[0].lat,undefined);assert.equal(info.pharmacies[0].lon,undefined);
  assert.deepEqual({...f.calls[0][2],accept:undefined},{freshMs:60000,staleMs:0,fallbackMs:0,timeoutMs:6000,persist:false,retries:0,accept:undefined});
  now.value=deadline;assert.equal(await f.getPharmacyPrices('prod_A1'),null);
  now.value=deadline+1;assert.equal(await f.getPharmacyPrices('prod_A1'),null);
});
test('unavailable, stale and invalid-expiry pharmacy payloads never become usable prices',async()=>{
  for(const overrides of [{complete:false},{stale:true},{data_state:'unavailable'},{valid_until:'invalid'}]) {
    const f=priceFixture({...snapshot(),...overrides},{value:deadline-1});
    assert.equal(await f.getPharmacyPrices('prod_A1'),null);
  }
});
function route(path, info) {
  const modules={'next/server':{NextResponse:{json:(body,config)=>Response.json(body,config)}},
    '@/lib/api':{getPrices:async()=>info},'@/lib/medusa':{getPharmacyPrices:async()=>info}};
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const loadedModule={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in modules,name);return modules[name];},loadedModule,loadedModule.exports);
  return loadedModule.exports.GET;
}
test('single and batch price routes cannot HTTP-cache successful, partial or empty snapshots',async()=>{
  const info={min:187.53,max:755.78,count:2,pharmacies:[],validUntil:new Date(deadline).toISOString()};
  for(const value of [info,null]) {
    const single=await route('src/app/api/price/[id]/route.ts',value)(new Request('https://shop.test/api/price/prod_A1'),{params:Promise.resolve({id:'prod_A1'})});
    assert.equal(single.headers.get('cache-control'),'no-store');assert.equal(single.status,value?200:503);
    for(const query of ['?ids=prod_A1','']) {
      const batch=await route('src/app/api/prices/route.ts',value)(new Request('https://shop.test/api/prices'+query));
      assert.equal(batch.headers.get('cache-control'),'no-store');
      const body=await batch.json();if(value&&query) assert.equal(body.prices.prod_A1.validUntil,info.validUntil);
    }
  }
});
test('client price cache expires on reuse after 60 seconds, capped by source validity',()=>{
  const now=100000,cache=new Map();
  const entry=priceCacheEntry(187.53,undefined,now);assert.deepEqual(entry,{min:187.53,expiresAt:160000});
  rememberPrice(cache,'prod_A1',entry);assert.equal(cachedPrice(cache,'prod_A1',159999).min,187.53);
  assert.equal(cachedPrice(cache,'prod_A1',160000),undefined);assert.equal(cache.size,0);
  const limited=priceCacheEntry(755.78,new Date(110000).toISOString(),now);
  assert.equal(limited.expiresAt,110000);rememberPrice(cache,'prod_A2',limited);
  assert.equal(cachedPrice(cache,'prod_A2',110000),undefined);
  assert.equal(priceCacheEntry(187.53,new Date(now).toISOString(),now),undefined);
  assert.equal(priceCacheEntry(187.53,'invalid',now),undefined);
  assert.equal(priceCacheEntry(187.531,undefined,now),undefined);
  assert.equal(priceCacheEntry(undefined,undefined,now),undefined);
  assert.deepEqual(priceCacheEntry(null,undefined,now),{min:null,expiresAt:160000});
  for(let i=0;i<1001;i++)rememberPrice(cache,String(i),entry);
  assert.equal(cache.size,1000);assert.equal(cache.has('0'),false);
  const hook=readFileSync('src/lib/price/usePrice.ts','utf8');assert.match(hook,/cachedPrice\(cache, id\)/);
  assert.doesNotMatch(hook,/setInterval/);
});
