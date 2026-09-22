import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const DELETE_BUTTON = new URL(
  "../src/components/cart/CartItemDeleteButton.tsx",
  import.meta.url,
);

const CART_PAGE = new URL("../src/app/cart/page.tsx", import.meta.url);
const CART_DRAWER = new URL(
  "../src/components/cart/CartDrawer.tsx",
  import.meta.url,
);
const DICT = new URL("../src/lib/i18n/dict.ts", import.meta.url);

test("removing a cart item requires choosing at least one reason", async () => {
  const [source, dict] = await Promise.all([
    readFile(DELETE_BUTTON, "utf8"),
    readFile(DICT, "utf8"),
  ]);

  assert.match(source, /cart\.removeReason\.title/);
  assert.match(dict, /Почему хотите убрать товар из корзины\?/);
  assert.match(source, /type="checkbox"/);
  assert.match(source, /checked=\{/);
  assert.match(source, /onChange=\{|onClick=\{/);

  const reasonCodes = [
    "not_needed",
    "added_by_mistake",
    "different_pack",
    "different_product",
    "price_or_delivery",
    "other",
  ];

  for (const reasonCode of reasonCodes) {
    assert.match(source, new RegExp(`id: "${reasonCode}"`));
  }

  assert.match(source, /disabled=\{[^}]*(?:selected|reason)[^}]*\}/i);
  assert.match(source, /cart\.removeReason\.confirm/);
  assert.match(dict, /"cart\.removeReason\.confirm": "Удалить из корзины"/);
  assert.match(source, /createPortal\(/);
});

test("reason choices are scoped to one delete attempt and removal keeps undo", async () => {
  const source = await readFile(DELETE_BUTTON, "utf8");

  assert.match(source, /const \[(?:selectedReasons?|reasons?), set(?:SelectedReasons?|Reasons?)\] = useState/i);
  assert.match(source, /set(?:SelectedReasons?|Reasons?)\((?:\[\]|new Set\(\)|"")\)/i);
  assert.match(source, /remove\(item\.product\.id, \[\.\.\.selectedReasons\]/);
  assert.match(source, /onClick: \(\) => restore\(item, index\)/);
  assert.match(source, /duration: 5_000/);

  const removalIndex = source.indexOf("remove(item.product.id,");
  const handlerIndex = source.indexOf("removeWithUndo");
  assert.ok(handlerIndex >= 0 && removalIndex > handlerIndex);
});

test("the same reason dialog protects deletion in both cart surfaces", async () => {
  const [page, drawer] = await Promise.all([
    readFile(CART_PAGE, "utf8"),
    readFile(CART_DRAWER, "utf8"),
  ]);

  assert.match(page, /<CartItemDeleteButton/);
  assert.match(drawer, /<CartItemDeleteButton/);
  assert.doesNotMatch(page, /onClick=\{\(\) => remove\(/);
  assert.doesNotMatch(drawer, /onClick=\{\(\) => remove\(/);
});
