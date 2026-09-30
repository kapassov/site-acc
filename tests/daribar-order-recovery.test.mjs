import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  daribarCustomerActorKey,
  daribarCustomerId,
  daribarCustomerIdFromActorKey,
} from "../src/lib/daribar/customer-identity.ts";

const ORDERS_ROUTE = new URL("../src/app/api/customer/orders/route.ts", import.meta.url);

test("Daribar customer identity is stable, secret-bound and contains no phone", () => {
  const secret = "checkout-customer-secret-at-least-32-bytes";
  const phone = "77000000000";
  const actorKey = daribarCustomerActorKey(`+${phone}`, secret);

  assert.match(actorKey, /^[a-f0-9]{64}$/);
  assert.equal(daribarCustomerId(phone, secret), daribarCustomerIdFromActorKey(actorKey));
  assert.doesNotMatch(daribarCustomerId(phone, secret), new RegExp(phone));
  assert.notEqual(actorKey, daribarCustomerActorKey(phone, `${secret}-rotated`));
});

test("customer orders are owned by our customer id and refresh Daribar status with a server token", async () => {
  const route = await readFile(ORDERS_ROUTE, "utf8");
  const session = route.indexOf("await customerSession(req)");
  const localOrders = route.indexOf("await listCustomerOrders(session.customerId, 100)", session);
  const serviceToken = route.indexOf("daribarServiceToken()", localOrders);
  const feed = route.indexOf("await getDaribarCustomerOrderFeed(accessToken)", serviceToken);
  const fallback = route.indexOf("await getDaribarCustomerOrder(accessToken, order.sourceOrderId)", feed);

  assert.ok(session >= 0 && localOrders > session && serviceToken > localOrders);
  assert.ok(feed > serviceToken && fallback > feed);
  assert.match(route, /providerMetadataPatch\(snapshot, payment\)/);
  assert.doesNotMatch(route, /daribarCustomerSession|setDaribarAuthCookies|DARIBAR_ACCESS_COOKIE/);
});
