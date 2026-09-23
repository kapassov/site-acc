import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { boundedCartQuantity, validCartItemForProvider, validMedusaCartItem } from '../src/lib/cart/medusa-cart.ts';
import { cartExtraCopy } from '../src/lib/i18n/cart-extra.ts';

const CURRENT='inkar-cart-v4-medusa',LEGACY='inkar-cart-v3-daribar',NOTICE='inkar-cart-migration-v4-medusa';
const oldCart=JSON.stringify([{product:{id:'daribar_123',source:'daribar'},qty:2}]);
const nativeItem={product:{id:'prod_A1',variantId:'variant_A1',source:'medusa',name:'Товар',price:187.53},qty:2};
const compiled=ts.transpileModule(readFileSync('src/lib/cart/CartContext.tsx','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
}).outputText;

function harness(values=new Map()) {
  const calls=[],listeners=new Map(),slots=[],effectSlots=[],queue=[];let uuidCounter=0;
  let cursor=0,effectCursor=0,dirty=true,view;
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{calls.push([key,value]);values.set(key,String(value));},
    removeItem:()=>{throw Error('Cart migration must never delete storage');}};
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
  const react={createContext:()=>({Provider:'provider'}),useContext:()=>view,
    useState:initial=>{const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;
      return [slots[index],next=>{const value=typeof next==='function'?next(slots[index]):next;if(!Object.is(slots[index],value)){slots[index]=value;dirty=true;}}];},
    useEffect:(effect,deps)=>{const index=effectCursor++,old=effectSlots[index];if(!old||!same(old.deps,deps)){effectSlots[index]={deps};queue.push(()=>{old?.cleanup?.();effectSlots[index].cleanup=effect();});}},
    useCallback:callback=>callback,useMemo:factory=>factory()};
  const modules={react,'react/jsx-runtime':{jsx:(type,props)=>({type,props})},
    '@/lib/analytics/client':{trackEvent:()=>{}},'@/lib/client-uuid':{browserUuidV4:()=> `11111111-1111-4111-8111-${String(++uuidCounter).padStart(12,'0')}`},
    './medusa-cart':{boundedCartQuantity,validCartItemForProvider,validMedusaCartItem}};
  const loadedModule={exports:{}};
  new Function('require','module','exports','localStorage','window',compiled)(name=>{assert.ok(name in modules,name);return modules[name];},loadedModule,loadedModule.exports,storage,
    {addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)});
  const flush=()=>{for(let pass=0;pass<12;pass++){if(dirty){dirty=false;cursor=0;effectCursor=0;view=loadedModule.exports.CartProvider({children:null}).props.value;}
    const tasks=queue.splice(0);tasks.forEach(run=>run());if(!dirty&&!queue.length)return view;}throw Error('Unstable cart hooks');};
  flush();return {values,calls,flush,view:()=>view,storage:event=>{listeners.get('storage')?.(event);return flush();}};
}

test('legacy cart migration notice survives new empty-cart persistence and repeated reloads',()=>{
  const values=new Map([[LEGACY,oldCart]]),first=harness(values);
  assert.equal(first.view().legacyItemsRemoved,true);assert.equal(first.view().items.length,0);
  assert.equal(values.get(CURRENT),'[]');assert.equal(values.get(NOTICE),'pending');assert.equal(values.get(LEGACY),oldCart);
  const second=harness(values);assert.equal(second.view().legacyItemsRemoved,true);
  const third=harness(values);assert.equal(third.view().legacyItemsRemoved,true);
  for(const h of [first,second,third])assert.ok(h.calls.every(([key])=>key!==LEGACY));
});
test('old nonempty cart is detected even when a previous release already wrote v4 empty cart',()=>{
  const h=harness(new Map([[LEGACY,oldCart],[CURRENT,'[]']]));assert.equal(h.view().legacyItemsRemoved,true);
  assert.equal(h.values.get(LEGACY),oldCart);assert.equal(h.values.get(NOTICE),'pending');
});
test('explicit acknowledgement hides only the notice and remains acknowledged on reload',()=>{
  const values=new Map([[LEGACY,oldCart],[CURRENT,JSON.stringify([nativeItem])]]),h=harness(values);
  assert.equal(h.view().legacyItemsRemoved,true);h.view().toggleSelected('prod_A1');h.flush();
  const before=new Map(values),items=h.view().items,instance=h.view().cartInstanceId,selected=h.view().selectedItems.length;
  h.calls.length=0;h.view().dismissLegacyNotice();h.flush();
  assert.equal(h.view().legacyItemsRemoved,false);assert.equal(h.view().items,items);assert.equal(h.view().cartInstanceId,instance);
  assert.equal(h.view().selectedItems.length,selected);assert.deepEqual(h.calls,[[NOTICE,'acknowledged']]);
  for(const [key,value] of before)if(key!==NOTICE)assert.equal(values.get(key),value);
  const reloaded=harness(values);assert.equal(reloaded.view().legacyItemsRemoved,false);
  assert.deepEqual(reloaded.view().items,[nativeItem]);assert.equal(values.get(LEGACY),oldCart);
});
test('new users and empty or malformed old carts do not get a migration warning',()=>{
  for(const legacy of [undefined,'[]','null','{}','not-json']) {
    const values=new Map([[CURRENT,JSON.stringify([nativeItem])]]);if(legacy!==undefined)values.set(LEGACY,legacy);
    const h=harness(values);assert.equal(h.view().legacyItemsRemoved,false);assert.equal(values.has(NOTICE),false);
    assert.deepEqual(h.view().items,[nativeItem]);assert.ok(h.calls.every(([key])=>key!==LEGACY));
  }
});
test('cart clearing does not acknowledge migration, while another-tab acknowledgement synchronizes notice only',()=>{
  const h=harness(new Map([[LEGACY,oldCart],[CURRENT,JSON.stringify([nativeItem])]]));
  h.view().clear();h.flush();assert.equal(h.view().legacyItemsRemoved,true);assert.equal(h.values.get(NOTICE),'pending');
  const before=h.values.get(LEGACY);h.storage({key:NOTICE,newValue:'acknowledged'});
  assert.equal(h.view().legacyItemsRemoved,false);assert.equal(h.values.get(LEGACY),before);
});
test('every material cart or checkout-selection mutation rotates the durable cart identity',()=>{
  const h=harness(new Map([[CURRENT,JSON.stringify([nativeItem])]]));
  const ids=[h.view().cartInstanceId];
  h.view().setQty('prod_A1',3);h.flush();ids.push(h.view().cartInstanceId);
  h.view().toggleSelected('prod_A1');h.flush();ids.push(h.view().cartInstanceId);
  h.view().remove('prod_A1');h.flush();ids.push(h.view().cartInstanceId);
  h.view().restore(nativeItem);h.flush();ids.push(h.view().cartInstanceId);
  const second={product:{id:'prod_B2',variantId:'variant_B2',source:'medusa',name:'Другой товар',price:250},qty:1};
  h.view().add(second.product);h.flush();ids.push(h.view().cartInstanceId);
  assert.equal(new Set(ids).size,ids.length);
});
test('cart notice renders in empty and filled paths with reactive RU/KZ/EN copy and an explicit accessible action',()=>{
  const page=readFileSync('src/app/cart/page.tsx','utf8'),empty=readFileSync('src/components/cart/EmptyCart.tsx','utf8');
  assert.match(page,/<EmptyCart notice=\{migrationNotice\}/);assert.match(empty,/\{notice\}/);
  assert.match(page,/\n      \{migrationNotice\}/);assert.match(page,/onClick=\{dismissLegacyNotice\}/);
  assert.match(page,/role="status" aria-labelledby="cart-migration-title"/);assert.match(page,/copy\.migration\.dismiss/);
  const labels=[];for(const lang of ['ru','kz','en']){const copy=cartExtraCopy[lang].migration;
    for(const key of ['title','text','dismiss'])assert.ok(typeof copy[key]==='string'&&copy[key].length>0);labels.push(copy.dismiss);}
  assert.equal(new Set(labels).size,3);
});
