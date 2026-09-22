import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMedusaCategoryHandle } from '../src/lib/category-aliases.ts';

test('old campaign links resolve to the Medusa two-level taxonomy', () => {
  assert.equal(resolveMedusaCategoryHandle('vitamins'), 'lekarstva-i-bady-vitaminy-i-mikroelementy');
  assert.equal(resolveMedusaCategoryHandle('bady'), 'lekarstva-i-bady');
  assert.equal(resolveMedusaCategoryHandle('linzy'), 'lekarstva-i-bady-zabota-o-zrenii');
  assert.equal(resolveMedusaCategoryHandle('sun'), 'kosmetika-solntsezaschitnye-sredstva');
  assert.equal(resolveMedusaCategoryHandle('mom-baby'), 'mama-i-malysh');
});

test('canonical and unknown category handles are not replaced by unrelated categories', () => {
  for (const value of ['lekarstva-i-bady', 'mama-i-malysh', 'unknown-category']) {
    assert.equal(resolveMedusaCategoryHandle(value), value);
  }
});
