import assert from "node:assert/strict";
import test from "node:test";
import { DaribarV3SearchError, searchDaribarProductsV3 } from "../src/lib/daribar/product-search-v3.ts";

test("v3 stock search sends the ASS integration header and parses exact stock plus analogs", async () => {
  const previousFetch = globalThis.fetch;
  const previous = {
    commerce: process.env.DARIBAR_COMMERCE_API_URL,
    integration: process.env.DARIBAR_INTEGRATION_CODE,
    network: process.env.DARIBAR_NETWORK_CODE,
  };
  try {
    process.env.DARIBAR_COMMERCE_API_URL = "https://prod-backoffice.daribar.com";
    process.env.DARIBAR_INTEGRATION_CODE = "apteka_so_sklada";
    globalThis.fetch = async (url, init) => {
      const target = new URL(String(url));
      assert.equal(target.pathname, "/api/v3/products/search");
      assert.equal(target.searchParams.get("city"), "Алматы");
      assert.equal(target.searchParams.get("enable_on_site"), "false");
      assert.equal(target.searchParams.get("use_adjustment"), "true");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), null);
      assert.equal(headers.get("x-integration-code"), "apteka_so_sklada");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        products: [{ sku: "SKU-1", count_desired: 3, priority: 7, replacements: [] }],
      });
      return new Response(JSON.stringify({ status: "success", result: [{
        source: {
          code: "ass-1", network_code: "ass", name: "Аптека АСС", city: "Алматы",
          address: "Абая 1", lat: 43.25, lon: 76.9, opening_hours: "24/7", working_today: true,
        },
        products: [{
          source_code: "ass-1", sku: "SKU-1", ware_id: "WARE-1", name: "Товар",
          base_price: 1200, price_with_warehouse_discount: 1100,
          quantity: 3, quantity_desired: 3,
          analogs: [{
            source_code: "ass-1", sku: "SKU-2", ware_id: "WARE-2", name: "Аналог",
            base_price: 900, price_with_warehouse_discount: 900,
            quantity: 1, quantity_desired: 3,
          }],
        }],
        haversine_distance: 1.5,
      }] }), { status: 200, headers: { "content-type": "application/json" } });

      const rows = await searchDaribarProductsV3({
        city: "Алматы", items: [{ sku: "SKU-1", countDesired: 3, priority: 7 }],
      });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].sourceCode, "ass-1");
      assert.equal(rows[0].products[0].quantity, 3);
      assert.equal(rows[0].products[0].price, 1100);
      assert.equal(rows[0].products[0].analogs[0].sku, "SKU-2");
      assert.equal(rows[0].distance, 1.5);
    };
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries({
      DARIBAR_COMMERCE_API_URL: previous.commerce,
      DARIBAR_INTEGRATION_CODE: previous.integration,
      DARIBAR_NETWORK_CODE: previous.network,
    })) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("v3 stock search rejects malformed upstream stock instead of publishing it", async () => {
  const previousFetch = globalThis.fetch;
  const previousOrigin = process.env.DARIBAR_COMMERCE_API_URL;
  try {
    process.env.DARIBAR_COMMERCE_API_URL = "https://prod-backoffice.daribar.com";
    globalThis.fetch = async () => new Response(JSON.stringify({ status: "success", result: [{
      source: { code: "ass-1", name: "Аптека", city: "Алматы" },
      products: [{ source_code: "ass-1", sku: "SKU-1", quantity: 5, quantity_desired: 1,
        base_price: 100, price_with_warehouse_discount: 100 }],
    }] }), { status: 200, headers: { "content-type": "application/json" } });
    await assert.rejects(
      searchDaribarProductsV3({ city: "Алматы", items: [{ sku: "SKU-1", countDesired: 1 }] }),
      (error) => error instanceof DaribarV3SearchError
        && error.code === "daribar_product_search_invalid_response",
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousOrigin == null) delete process.env.DARIBAR_COMMERCE_API_URL;
    else process.env.DARIBAR_COMMERCE_API_URL = previousOrigin;
  }
});
