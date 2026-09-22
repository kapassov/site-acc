import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("single cart items use the shared reason dialog and keep bounded undo", async () => {
  const [page, drawer, deleteButton, toastContext, cartContext] = await Promise.all([
    readFile(new URL("../src/app/cart/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/cart/CartDrawer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/cart/CartItemDeleteButton.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/ui/ToastContext.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/cart/CartContext.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /onClick=\{\(\) => remove\(/);
  assert.doesNotMatch(drawer, /onClick=\{\(\) => remove\(/);
  assert.match(page, /<CartItemDeleteButton/);
  assert.match(drawer, /<CartItemDeleteButton/);
  assert.match(deleteButton, /remove\(item\.product\.id, \[\.\.\.selectedReasons\]/);
  assert.match(deleteButton, /setConfirming\(true\)/);
  assert.match(deleteButton, /role="dialog"/);
  assert.match(deleteButton, /cart\.removeReason\.title/);
  assert.match(deleteButton, /onClick=\{removeWithUndo\}/);
  assert.doesNotMatch(deleteButton, /deleteStep|Подтверждение \{deleteStep\}/);
  assert.match(deleteButton, /onClick: \(\) => restore\(item, index\)/);
  assert.match(deleteButton, /duration: 5_000/);
  assert.match(toastContext, /action\?:/);
  assert.match(cartContext, /const restore = useCallback/);
  assert.match(page, /<ConfirmCartDelete[\s\S]*trigger="text"/);
});
