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

test("customer orders recover Daribar storefront orders with the verified profile", async () => {
  const route = await readFile(ORDERS_ROUTE, "utf8");
  const session = route.indexOf("await daribarCustomerSession(req)");
  const daribarBranch = route.indexOf("if (daribarSession)");
  const localOrders = route.indexOf("await listCustomerOrders(daribarSession.customerId, 100)", daribarBranch);
  const feed = route.indexOf("await getDaribarCustomerOrderFeed(daribarSession.accessToken)", localOrders);
  const fallback = route.indexOf("await getDaribarCustomerOrder(daribarSession.accessToken, order.sourceOrderId)", feed);
  const medusaBranch = route.indexOf("const medusaToken");

  assert.ok(session >= 0 && daribarBranch > session && localOrders > daribarBranch);
  assert.ok(feed > localOrders && fallback > feed && medusaBranch > fallback);
  assert.match(route, /providerMetadataPatch\(snapshot\)/);
  assert.match(route, /setDaribarAuthCookies\(response, daribarSession\.rotatedTokens\)/);
  assert.match(route, /const medusaToken = cookieStore\.get\("ms_cust"\)/);
  assert.match(route, /token: medusaToken/);
  assert.doesNotMatch(route, /authorization[^\n]*ms_cust|bearer[^\n]*ms_cust/i);
});
