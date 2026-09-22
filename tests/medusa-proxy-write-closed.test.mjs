import assert from 'node:assert/strict';
import test from 'node:test';

const routeUrl=new URL('../src/app/api/medusa/[...path]/route.ts',import.meta.url);
test('legacy cart/order/payment POST and DELETE are denied without body, credentials, params or upstream access',async t=>{
  const before={MEDUSA_URL:process.env.MEDUSA_URL,MEDUSA_PUBLISHABLE_KEY:process.env.MEDUSA_PUBLISHABLE_KEY};
  process.env.MEDUSA_URL='https://medusa-write-closed.example';process.env.MEDUSA_PUBLISHABLE_KEY='pk_private_not_for_response';
  t.after(()=>{for(const [key,value]of Object.entries(before))if(value===undefined)delete process.env[key];else process.env[key]=value;});
  const fetch=t.mock.method(globalThis,'fetch',async()=>{throw Error('No upstream call permitted');});
  const routes=await import(`${routeUrl.href}?write-closed=${Date.now()}`);
  let forbiddenReads=0;
  const forbidden=()=>{forbiddenReads++;throw Error('Denied request must not read request body, headers or params');};
  const context={get params(){return forbidden();}};
  for(const path of ['store/carts','store/carts/cart_test/line-items','store/carts/cart_test/complete',
    'store/payment-collections/paycol_test/payment-sessions','store/orders/order_test','store/standardn/orders']) {
    for(const method of ['POST','DELETE']) {
      const request={method,url:`https://shop.example/api/medusa/${path}`,get body(){return forbidden();},get headers(){return forbidden();},json:forbidden,text:forbidden,arrayBuffer:forbidden};
      const response=await routes[method](request,context);
      assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'GET');
      assert.equal(response.headers.get('cache-control'),'no-store');
      const text=await response.text();assert.deepEqual(JSON.parse(text),{error:'method_not_allowed'});
      assert.ok(!text.includes(process.env.MEDUSA_PUBLISHABLE_KEY));
    }
  }
  assert.equal(forbiddenReads,0);assert.equal(fetch.mock.callCount(),0);
  // Even calling the legacy GET export with a forged write request cannot
  // resurrect the removed generic write branch.
  assert.equal((await routes.GET({method:'POST',get headers(){return forbidden();}},context)).status,405);
  assert.equal(forbiddenReads,0);assert.equal(fetch.mock.callCount(),0);
});
test('write-denial is independent of configuration and is not unlocked by session or forged bridge headers',async t=>{
  const before={MEDUSA_URL:process.env.MEDUSA_URL,MEDUSA_PUBLISHABLE_KEY:process.env.MEDUSA_PUBLISHABLE_KEY};
  delete process.env.MEDUSA_URL;delete process.env.MEDUSA_PUBLISHABLE_KEY;
  t.after(()=>{for(const [key,value]of Object.entries(before))if(value===undefined)delete process.env[key];else process.env[key]=value;});
  const fetch=t.mock.method(globalThis,'fetch',async()=>{throw Error('No upstream call permitted');});
  const routes=await import(`${routeUrl.href}?write-unconfigured=${Date.now()}`);
  for(const method of ['POST','DELETE']) {
    const response=await routes[method](new Request('https://shop.example/api/medusa/store/carts/cart_test/complete',{
      method,headers:{cookie:'daribar_access=fake-session',authorization:'Bearer fake-token','x-publishable-api-key':'fake-client-key','x-standardn-signature':'fake-signature'},body:'{}',
    }),{params:Promise.resolve({path:['store','carts','cart_test','complete']})});
    assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'GET');assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual(await response.json(),{error:'method_not_allowed'});
  }
  assert.equal(fetch.mock.callCount(),0);
});
