import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DaribarCheckoutError,
  firstExactDaribarCheckoutOffer,
  MAX_EXACT_OFFER_CANDIDATES,
  parseDaribarCheckoutOffers,
  searchDaribarCheckoutOffers,
} from "../src/lib/daribar/checkout.ts";
import {
  DaribarAvailabilityError,
  getDaribarExactPharmacyStock,
} from "../src/lib/daribar/availability.ts";
import { daribarProductId, daribarVariantId } from "../src/lib/daribar/ids.ts";

const CHECKOUT = new URL("../src/lib/daribar/checkout.ts", import.meta.url);
const QUOTE = new URL("../src/lib/checkoutQuote.ts", import.meta.url);

test("Daribar checkout verifies exact SKU, stock, pharmacy and server prices", async () => {
  const source = await readFile(CHECKOUT, "utf8");

  assert.match(source, /"\/api\/v2\/products\/search"/);
  assert.match(source, /origin: "auth"/);
  assert.match(source, /auth: false/);
  assert.match(source, /network !== expectedNetwork/);
  assert.match(source, /daribarNetworkCode\(\)/);
  assert.match(source, /source_code: selectedSource \|\| undefined/);
  assert.match(source, /sku !== item\.sku/);
  assert.match(source, /availableQuantity < item\.quantity/);
  assert.match(source, /price_with_warehouse_discount/);
  assert.match(source, /base_price/);
  assert.match(source, /lines\.length !== requested\.length/);
  assert.doesNotMatch(source, /input\.(?:price|total|unitPrice)/);
});

test("Daribar order creation uses user auth and maps storefront delivery/payment", async () => {
  const source = await readFile(CHECKOUT, "utf8");

  assert.match(source, /payment_method: input\.payment === "cash" \? "in_place" : "interpay"/);
  assert.match(source, /delivery_method: isPickup \? "self" : deliveryMethod\(deliveryQuote!\.provider\)/);
  assert.match(source, /"\/api\/v2\/orders"/);
  assert.match(source, /origin: "order"/);
  assert.match(source, /auth: false/);
  assert.match(source, /authorization: `Bearer \$\{token\}`/);
  assert.match(source, /DARIBAR_PARTNER_TOKEN|daribarPartnerToken/);
  assert.match(source, /daribarOrderItemsFromOffer/);
});

test("active quote keeps Medusa product identities but binds live Daribar stock", async () => {
  const source = await readFile(QUOTE, "utf8");

  assert.match(source, /detectCheckoutItemsSource\(items\) !== "medusa"/);
  assert.match(source, /stale_cart/);
  assert.match(source, /version: 3/);
  assert.match(source, /requestDaribarStockQuote/);
  assert.match(source, /requestDaribarStockQuotes/);
  assert.match(source, /validStandardNQuote\(payload, canonical\)/);
  assert.match(source, /payload\.itemsHash !== itemsHash\(canonical\)/);
  assert.doesNotMatch(source, /requestStandardNQuote/);
  assert.doesNotMatch(source, /searchDaribarCheckoutOffers|firstExactDaribarCheckoutOffer/);
});

test("Daribar v2 offer parser rejects cheaper pharmacies outside the configured network", () => {
  const sku = "SKU-NETWORK-1";
  const items = [{ productId: daribarProductId(sku), variantId: daribarVariantId(sku), quantity: 2 }];
  const product = {
    sku,
    source_code: "own-pharmacy",
    quantity: 5,
    base_price: 1500,
  };
  const offers = parseDaribarCheckoutOffers({
    status: "success",
    result: [
      {
        source: { code: "foreign-pharmacy", network_code: "foreign-network", name: "Чужая сеть", city: "Алматы" },
        products: [{ ...product, source_code: "foreign-pharmacy", base_price: 1 }],
      },
      {
        source: { code: "own-pharmacy", network_code: "own-network", name: "Наша аптека", city: "Алматы" },
        products: [product],
      },
    ],
  }, items, "own-network");

  assert.equal(offers.length, 1);
  assert.equal(offers[0].sourceCode, "own-pharmacy");
  assert.equal(offers[0].lines[0].availableQuantity, 5);
  assert.equal(offers[0].total, 3000);
  assert.throws(
    () => parseDaribarCheckoutOffers({ status: "success", result: [] }, items, "../../invalid"),
    /invalid_daribar_network/,
  );
});

test("exact pharmacy enrichment uses one production v3 basket request", async () => {
  const previousFetch = globalThis.fetch;
  const previousOrigin = process.env.DARIBAR_AUTH_API_URL;
  const previousCommerce = process.env.DARIBAR_COMMERCE_API_URL;
  const previousNetwork = process.env.DARIBAR_NETWORK_CODE;
  const seenOrigins = new Set();
  try {
    process.env.DARIBAR_AUTH_API_URL = "https://prod-backoffice.daribar.com";
    process.env.DARIBAR_COMMERCE_API_URL = "https://prod-backoffice.daribar.com";
    process.env.DARIBAR_NETWORK_CODE = "apteka_so_sklada";
    globalThis.fetch = async (url, init) => {
      const requestUrl = new URL(String(url));
      seenOrigins.add(requestUrl.origin);
      assert.equal(requestUrl.pathname, "/api/v3/products/search");
      assert.equal(requestUrl.searchParams.get("source_code"), "own-pharmacy");
      const headers = new Headers(init?.headers);
      assert.equal(headers.has("authorization"), false);
      assert.equal(headers.get("x-integration-code"), "apteka_so_sklada");
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ status: "success", result: [{
        source: { code: "own-pharmacy", name: "ASS", city: "Алматы", address: "Абая 1" },
        products: body.products.map((item) => ({
          source_code: "own-pharmacy", sku: item.sku, ware_id: `ware-${item.sku}`,
          name: item.sku, quantity: 2, quantity_desired: item.count_desired,
          base_price: 1250, price_with_warehouse_discount: 1250,
        })),
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const lines = await getDaribarExactPharmacyStock({
      sourceCode: "own-pharmacy",
      city: "Алматы",
      items: Array.from({ length: 5 }, (_, index) => ({ sku: `SKU-${index + 1}`, quantity: 2 })),
    });
    assert.equal(lines.length, 5);
    assert.deepEqual([...seenOrigins], ["https://prod-backoffice.daribar.com"]);
    assert.deepEqual(lines[0], { sku: "SKU-1", availableQuantity: 2, unitPrice: 1250 });

    globalThis.fetch = async () => new Response(JSON.stringify({ status: "success", result: [{
      source: { code: "own-pharmacy", name: "ASS", city: "Алматы", address: "Абая 1" },
      products: [{ source_code: "own-pharmacy", sku: "ANALOG-NOT-REQUESTED", quantity: 1,
        quantity_desired: 1, base_price: 1, price_with_warehouse_discount: 1 }],
    }],
    }), { status: 200, headers: { "content-type": "application/json" } });
    await assert.rejects(
      getDaribarExactPharmacyStock({
        sourceCode: "own-pharmacy",
        city: "Алматы",
        items: [{ sku: "SKU-EXACT", quantity: 1 }],
      }),
      (error) => error instanceof DaribarAvailabilityError && error.code === "cart_item_unavailable",
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCommerce == null) delete process.env.DARIBAR_COMMERCE_API_URL;
    else process.env.DARIBAR_COMMERCE_API_URL = previousCommerce;
    if (previousNetwork == null) delete process.env.DARIBAR_NETWORK_CODE;
    else process.env.DARIBAR_NETWORK_CODE = previousNetwork;
    if (previousOrigin == null) delete process.env.DARIBAR_AUTH_API_URL;
    else process.env.DARIBAR_AUTH_API_URL = previousOrigin;
  }
});

test("exact checkout falls back to the next ranked pharmacy and caps attempts", async () => {
  const previousFetch = globalThis.fetch;
  const previousOrigin = process.env.DARIBAR_AUTH_API_URL;
  const previousCommerce = process.env.DARIBAR_COMMERCE_API_URL;
  const previousNetwork = process.env.DARIBAR_NETWORK_CODE;
  const sku = "SKU-FALLBACK-1";
  const productId = daribarProductId(sku);
  const variantId = daribarVariantId(sku);
  const makeOffer = (sourceCode) => ({
    sourceCode,
    pharmacy: { id: sourceCode, name: sourceCode, city: "Алматы" },
    lines: [{
      productId,
      variantId,
      sku,
      quantity: 2,
      availableQuantity: 2,
      unitPrice: 1000,
      total: 2000,
    }],
    total: 2000,
  });
  const seen = [];
  try {
    process.env.DARIBAR_AUTH_API_URL = "https://prod-backoffice.daribar.com";
    process.env.DARIBAR_COMMERCE_API_URL = "https://prod-backoffice.daribar.com";
    process.env.DARIBAR_NETWORK_CODE = "apteka_so_sklada";
    globalThis.fetch = async (url, init) => {
      const target = new URL(String(url));
      const sourceCode = target.searchParams.get("source_code");
      const body = JSON.parse(String(init?.body));
      seen.push(sourceCode);
      return new Response(JSON.stringify({ status: "success", result: sourceCode === "pharmacy-b" ? [{
        source: { code: sourceCode, name: sourceCode, city: "Алматы", address: "Абая 1" },
        products: [{ source_code: sourceCode, sku, quantity: 2,
          quantity_desired: body.products[0].count_desired,
          base_price: 1200, price_with_warehouse_discount: 1200 }],
      }] : [] }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const selected = await firstExactDaribarCheckoutOffer([
      makeOffer("pharmacy-a"),
      makeOffer("pharmacy-b"),
      makeOffer("pharmacy-c"),
    ]);
    assert.equal(selected?.sourceCode, "pharmacy-b");
    assert.equal(selected?.lines[0].availableQuantity, 2);
    assert.equal(selected?.lines[0].unitPrice, 1200);
    assert.deepEqual(seen, ["pharmacy-a", "pharmacy-b"]);

    seen.length = 0;
    const unavailable = await firstExactDaribarCheckoutOffer(
      Array.from({ length: MAX_EXACT_OFFER_CANDIDATES + 2 }, (_, index) => makeOffer(`missing-${index}`)),
    );
    assert.equal(unavailable, null);
    assert.equal(seen.length, MAX_EXACT_OFFER_CANDIDATES);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousOrigin == null) delete process.env.DARIBAR_AUTH_API_URL;
    else process.env.DARIBAR_AUTH_API_URL = previousOrigin;
    if (previousCommerce == null) delete process.env.DARIBAR_COMMERCE_API_URL;
    else process.env.DARIBAR_COMMERCE_API_URL = previousCommerce;
    if (previousNetwork == null) delete process.env.DARIBAR_NETWORK_CODE;
    else process.env.DARIBAR_NETWORK_CODE = previousNetwork;
  }
});

test("quote search maps safe Daribar transport codes to checkout errors", async () => {
  const previousFetch = globalThis.fetch;
  const previousEnabled = process.env.DARIBAR_ENABLED;
  const previousOrigin = process.env.DARIBAR_AUTH_API_URL;
  const previousNetwork = process.env.DARIBAR_NETWORK_CODE;
  const sku = "SKU-NETWORK-ERROR";
  try {
    process.env.DARIBAR_ENABLED = "true";
    process.env.DARIBAR_AUTH_API_URL = "https://prod-backoffice.daribar.com";
    process.env.DARIBAR_NETWORK_CODE = "own-network";
    globalThis.fetch = async () => new Response(
      JSON.stringify({ status: "error", error: "daribar_unavailable" }),
      { status: 503, headers: { "content-type": "application/json" } },
    );

    await assert.rejects(
      searchDaribarCheckoutOffers({
        items: [{ productId: daribarProductId(sku), variantId: daribarVariantId(sku), quantity: 1 }],
        city: "Алматы",
      }),
      (error) => error instanceof DaribarCheckoutError
        && error.status === 503
        && error.code === "daribar_unavailable",
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnabled == null) delete process.env.DARIBAR_ENABLED;
    else process.env.DARIBAR_ENABLED = previousEnabled;
    if (previousOrigin == null) delete process.env.DARIBAR_AUTH_API_URL;
    else process.env.DARIBAR_AUTH_API_URL = previousOrigin;
    if (previousNetwork == null) delete process.env.DARIBAR_NETWORK_CODE;
    else process.env.DARIBAR_NETWORK_CODE = previousNetwork;
  }
});
