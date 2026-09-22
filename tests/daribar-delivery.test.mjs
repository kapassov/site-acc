import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  DaribarDeliveryError, deliveryDestinationHash, deliveryForPharmacy,
  normalizeDeliveryDestination, parseDaribarDeliveryOffer,
} from "../src/lib/daribar/delivery.ts";
import { buildDaribarOrderPayload } from "../src/lib/daribar/checkout.ts";
import {
  buildDaribarDeliveryClaimPayload,
  createDaribarDeliveryClaim,
  DaribarDeliveryClaimError,
  parseDaribarDeliveryClaimResponse,
} from "../src/lib/daribar/delivery-claim.ts";

const CHECKOUT_DELIVERY = new URL("../src/lib/checkout-delivery.ts", import.meta.url);

const expected = [{ sku: "1234567890", countDesired: 2 }];
const actualOffer = () => ({
  pharmacy: { code: "apteka_almaty_001", name: "Аптека №1", city: "Алматы", address: "Абая, 1" },
  items_price: 900,
  items: [{ source_code: "apteka_almaty_001", sku: "1234567890", base_price: 500,
    price_with_warehouse_discount: 450, quantity: 5, quantity_desired: 2 }],
  delivery: [
    { provider: "yandex", delivery_type: "ondemand", price: 890, eta: 45, distance: 2.4 },
    { provider: "yandex", delivery_type: "pedestrian", price: 650, eta: 55, distance: 2.4 },
  ],
});

test("checkout revalidates the selected delivery pharmacy through v3 basket stock", async () => {
  const source = await readFile(CHECKOUT_DELIVERY, "utf8");
  assert.match(source, /getDaribarExactPharmacyStock/);
  assert.match(source, /offer\.orderItems\.map/);
  assert.match(source, /await verifyCurrentDaribarStock\(offer, city\)/);
  assert.match(source, /selected_pharmacy_unavailable/);
});

test("Daribar price response reconciles SKU, stock, item total and cheapest delivery", () => {
  const parsed = parseDaribarDeliveryOffer(actualOffer(), expected);
  assert.equal(parsed?.bestDelivery.price, 650);
  assert.equal(parsed?.total, 1550);
  assert.deepEqual(parsed?.orderItems, [{ sku: "1234567890", countDesired: 2, pharmacyCount: 5 }]);
  const mismatch = actualOffer(); mismatch.items_price = 901;
  assert.equal(parseDaribarDeliveryOffer(mismatch, expected), null);
});

test("ondemand is normalized internally and destination is bound by a stable hash", () => {
  const one = actualOffer(); one.delivery = [one.delivery[0]];
  assert.equal(parseDaribarDeliveryOffer(one, expected)?.bestDelivery.deliveryType, "on_demand");
  assert.deepEqual(normalizeDeliveryDestination({ address: "  Абая, 1 " }), { address: "Абая, 1" });
  assert.equal(deliveryDestinationHash(" Алматы ", "АБАЯ,   1"), deliveryDestinationHash("алматы", "абая, 1"));
});

test("order carries the exact signed provider, price, ETA and stock", () => {
  const deliveryQuote = { mode: "pharmacy", provider: "yandex", deliveryType: "on_demand",
    price: 890, itemsPrice: 900, orderItems: [{ sku: "1234567890", countDesired: 2, pharmacyCount: 5 }],
    eta: 45, distance: 2.4, daribarSourceCode: "apteka_almaty_001", pharmacyId: "sloc_test",
    destinationHash: "0".repeat(64), quotedAt: new Date().toISOString() };
  const payload = buildDaribarOrderPayload({
    offer: { sourceCode: "apteka_almaty_001", pharmacy: { city: "Алматы" },
      lines: [{ sku: "1234567890", quantity: 2, availableQuantity: 5 }] },
    phone: "+77001234567", delivery: "courier", payment: "card", city: "Алматы",
    address: "ул. Абая, 123", deliveryQuote,
  });
  assert.equal(payload.payment_method, "interpay");
  assert.equal(payload.phone, "77001234567");
  assert.equal(payload.delivery_method, "delivery_yandex");
  assert.equal(Object.hasOwn(payload.delivery?.dst || {}, "icon"), false);
  assert.deepEqual(payload.delivery && { type: payload.delivery.type, provider: payload.delivery.provider,
    price: payload.delivery.price, eta: payload.delivery.eta, on_demand: payload.delivery.on_demand,
    slots: payload.delivery.slots },
  { type: "ondemand", provider: "yandex", price: 890, eta: 45, on_demand: true,
    slots: [{ delivery_type: "ondemand", provider: "yandex", price: 890, eta: 45, distance: 2.4 }] });
});

test("courier claim is linked to the order and carries the full delivery address", () => {
  const quote = { mode: "pharmacy", provider: "yandex", deliveryType: "on_demand",
    price: 890, itemsPrice: 900, orderItems: [{ sku: "1234567890", countDesired: 2, pharmacyCount: 5 }],
    eta: 45, distance: 2.4, daribarSourceCode: "apteka_almaty_001", pharmacyId: "sloc_test",
    destinationHash: "0".repeat(64), quotedAt: new Date().toISOString() };
  const payload = buildDaribarDeliveryClaimPayload({
    accessToken: "x".repeat(20), orderId: "order-123", quote, city: "Алматы",
    address: "ул. Абая, 123", phone: "+7 (700) 123-45-67", name: "Иван",
    orderPrice: 1790, comment: "Позвоните",
    deliveryDetails: { placeType: "apartment", unit: "45", entrance: "2", floor: "5",
      intercom: "45#", instructions: "вход со двора", leaveAtDoor: false },
  });
  assert.equal(payload.order_id, "order-123");
  assert.equal(payload.pharmacy_code, "apteka_almaty_001");
  assert.equal(payload.taxi_class, "on_demand");
  assert.deepEqual(payload.destination, {
    city: "Алматы", street: "ул. Абая", building: "123", flat: "45", entrance: "2", floor: "5",
    comment: "Домофон/код: 45#; вход со двора", contact: { phone: "77001234567", name: "Иван" },
  });
});

test("claim response is parsed fail-closed", () => {
  assert.deepEqual(parseDaribarDeliveryClaimResponse("yandex", { status: "success", result: {
    claim_id: "claim-1", claim_status: "ready_for_approval", claim_price: 900,
    valid_until: "2026-09-14T10:00:00+05:00",
  } }), { provider: "yandex", id: "claim-1", status: "ready_for_approval", price: 900,
    validUntil: "2026-09-14T10:00:00+05:00" });
  assert.throws(() => parseDaribarDeliveryClaimResponse("yandex", { status: "success", result: {} }),
    error => error instanceof DaribarDeliveryClaimError && error.code === "delivery_claim_invalid_response");
});

test("claim call uses customer authentication and a separate optional partner token", async () => {
  const previousFetch = globalThis.fetch;
  const old = { enabled: process.env.DARIBAR_ENABLED, delivery: process.env.DARIBAR_DELIVERY_ENABLED,
    origin: process.env.DARIBAR_COMMERCE_API_URL, partner: process.env.DARIBAR_PARTNER_TOKEN };
  process.env.DARIBAR_ENABLED = "true"; process.env.DARIBAR_DELIVERY_ENABLED = "true";
  process.env.DARIBAR_COMMERCE_API_URL = "https://prod-backoffice.daribar.com";
  process.env.DARIBAR_PARTNER_TOKEN = "partner-token-1234567890";
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(new URL(String(url)).pathname, "/api/v2/delivery/claim");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), `Bearer ${"a".repeat(20)}`);
      assert.equal(headers.get("x-partner-token"), "partner-token-1234567890");
      return Response.json({ status: "success", result: {
        claim_id: "claim-2", claim_status: "ready_for_approval", claim_price: 650,
      } });
    };
    const quote = { mode: "pharmacy", provider: "yandex", deliveryType: "pedestrian",
      price: 650, itemsPrice: 900, orderItems: [{ sku: "1234567890", countDesired: 2, pharmacyCount: 5 }],
      eta: 55, distance: 2.4, daribarSourceCode: "apteka_almaty_001", pharmacyId: "sloc_test",
      destinationHash: "0".repeat(64), quotedAt: new Date().toISOString() };
    const claim = await createDaribarDeliveryClaim({ accessToken: "a".repeat(20), orderId: "order-123",
      quote, city: "Алматы", address: "Абая, 1", phone: "77001234567", orderPrice: 1550 });
    assert.equal(claim.id, "claim-2");
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries({ DARIBAR_ENABLED: old.enabled,
      DARIBAR_DELIVERY_ENABLED: old.delivery, DARIBAR_COMMERCE_API_URL: old.origin,
      DARIBAR_PARTNER_TOKEN: old.partner })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("delivery pricing and order creation use independently configurable authorities", async () => {
  const [config, checkout, delivery, route] = await Promise.all([
    readFile(new URL("../src/lib/daribar/config.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/daribar/checkout.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/daribar/delivery.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/checkout/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(config, /DARIBAR_COMMERCE_API_URL/);
  assert.match(config, /DARIBAR_ORDER_API_URL/);
  assert.match(checkout, /origin: "order"/);
  assert.match(delivery, /origin: "commerce"/);
  assert.match(route, /createDaribarOrderForQuote/);
  assert.match(route, /createDaribarDeliveryClaim/);
});

test("only delivery options that can be represented by the order contract are shown", async () => {
  const oldFetch = globalThis.fetch;
  const old = { enabled: process.env.DARIBAR_ENABLED, delivery: process.env.DARIBAR_DELIVERY_ENABLED,
    origin: process.env.DARIBAR_COMMERCE_API_URL };
  process.env.DARIBAR_ENABLED = "true"; process.env.DARIBAR_DELIVERY_ENABLED = "true";
  process.env.DARIBAR_COMMERCE_API_URL = "https://prod-backoffice.daribar.com";
  try {
    globalThis.fetch = async () => Response.json({ status: "success", result: {
      ...actualOffer(), delivery: [
        { provider: "yandex", delivery_type: "slot", price: 100, eta: 120, distance: 2.4 },
        { provider: "choco", delivery_type: "pedestrian", price: 200, eta: 30, distance: 2.4 },
        { provider: "yandex", delivery_type: "ondemand", price: 890, eta: 45, distance: 2.4 },
      ],
    } });
    const result = await deliveryForPharmacy({ sourceCode: "apteka_almaty_001", items: expected,
      destination: { address: "Алматы, Абая, 123" } });
    assert.deepEqual(result.options.map(option => [option.provider, option.deliveryType]), [["yandex", "on_demand"]]);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries({ DARIBAR_ENABLED: old.enabled,
      DARIBAR_DELIVERY_ENABLED: old.delivery, DARIBAR_COMMERCE_API_URL: old.origin })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("unsupported-only delivery fails closed", async () => {
  const oldFetch = globalThis.fetch, oldEnabled = process.env.DARIBAR_ENABLED, oldDelivery = process.env.DARIBAR_DELIVERY_ENABLED;
  process.env.DARIBAR_ENABLED = "true"; process.env.DARIBAR_DELIVERY_ENABLED = "true";
  try {
    globalThis.fetch = async () => Response.json({ status: "success", result: {
      ...actualOffer(), delivery: [{ provider: "yandex", delivery_type: "slot", price: 100, eta: 120, distance: 2.4 }],
    } });
    await assert.rejects(deliveryForPharmacy({ sourceCode: "apteka_almaty_001", items: expected,
      destination: { address: "Алматы, Абая, 123" } }),
    error => error instanceof DaribarDeliveryError && error.code === "delivery_invalid_response");
  } finally {
    globalThis.fetch = oldFetch;
    if (oldEnabled === undefined) delete process.env.DARIBAR_ENABLED;
    else process.env.DARIBAR_ENABLED = oldEnabled;
    if (oldDelivery === undefined) delete process.env.DARIBAR_DELIVERY_ENABLED;
    else process.env.DARIBAR_DELIVERY_ENABLED = oldDelivery;
  }
});
