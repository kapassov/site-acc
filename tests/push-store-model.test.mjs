import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canBindOrder, customerChanged } from "../src/lib/push/model.ts";

const ownedOrder = {
  id: "order_01",
  sourceOrderId: "order_01",
  displayNumber: 1042,
  customerId: "cus_owner",
};

test("a device cannot bind another customer's order number", () => {
  assert.equal(canBindOrder(ownedOrder, "1042", "cus_attacker", "cus_attacker"), false);
  assert.equal(canBindOrder(ownedOrder, "1042", "cus_owner", "cus_attacker"), false);
  assert.equal(canBindOrder(ownedOrder, "1042", "cus_owner", "cus_owner"), true);
  assert.equal(canBindOrder(ownedOrder, "order_01", "cus_owner", "cus_owner"), true);
});

test("re-registering a device for a different or formerly unknown customer clears bindings", () => {
  assert.equal(customerChanged("cus_old", "cus_new"), true);
  assert.equal(customerChanged(undefined, "cus_new"), true);
  assert.equal(customerChanged("cus_same", "cus_same"), false);
});

test("Postgres binding is guarded by both device and site order ownership", async () => {
  const source = await readFile(new URL("../src/lib/push/postgres-store.ts", import.meta.url), "utf8");
  assert.match(source, /DELETE FROM push_order_bindings WHERE device_id = \$1/);
  assert.match(source, /AND customer_id = \$3[\s\S]+FROM site_orders owned_order[\s\S]+owned_order\.customer_id = \$3/);
  assert.match(source, /owned_order\.display_number::text = \$1/);
});
