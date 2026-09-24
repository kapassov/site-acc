import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { storefrontCatalogProvider, servesDaribarCatalog, storefrontCheckoutSource } from "../src/lib/catalog-provider.ts";
import { normalizeDaribarSnapshot } from "../scripts/publish-daribar-catalog.mjs";
import { readDaribarCatalogDatabase } from "../src/lib/daribar/catalog-db.ts";
import { validCartItemForProvider } from "../src/lib/cart/medusa-cart.ts";
import { daribarProductId, daribarVariantId } from "../src/lib/daribar/ids.ts";

function raw(sku, price = 1000) {
  return { sku, name: `Товар ${sku}`, categories_ids: ["9"], min_customer_price: price, quantity: 3 };
}

test("catalogue provider defaults to Medusa and supports shadow and one-step Daribar rollback", () => {
  assert.equal(storefrontCatalogProvider({}), "medusa");
  assert.equal(storefrontCatalogProvider({ STOREFRONT_CATALOG_PROVIDER: "shadow" }), "shadow");
  assert.equal(servesDaribarCatalog({ STOREFRONT_CATALOG_PROVIDER: "shadow" }), false);
  assert.equal(servesDaribarCatalog({ STOREFRONT_CATALOG_PROVIDER: "daribar" }), true);
  assert.equal(storefrontCheckoutSource({ STOREFRONT_CATALOG_PROVIDER: "daribar" }), "daribar");
  assert.equal(storefrontCheckoutSource({ STOREFRONT_CATALOG_PROVIDER: "shadow" }), "medusa");
  assert.equal(storefrontCatalogProvider({ STOREFRONT_CATALOG_PROVIDER: "invalid" }), "medusa");
});

test("snapshot normalizer creates one native product and variant identity per Daribar SKU", () => {
  const products = normalizeDaribarSnapshot({
    uniqueCount: 2,
    products: [raw("SKU-ONE", 1250), raw("SKU-TWO", 2400)],
  });
  assert.equal(products.length, 2);
  assert.equal(products[0].product.source, "daribar");
  assert.equal(products[0].product_id, daribarProductId("SKU-ONE"));
  assert.equal(products[0].variant_id, daribarVariantId("SKU-ONE"));
  assert.equal(products[0].price_amount, 1250);
  assert.throws(() => normalizeDaribarSnapshot({ uniqueCount: 2, products: [raw("DUP"), raw("DUP")] }),
    /daribar_catalog_normalized_duplicate/);
});

test("database reader serves only a complete active published Daribar run", async () => {
  const product = normalizeDaribarSnapshot({ uniqueCount: 1, products: [raw("SKU-DB")] })[0].product;
  const queries = [];
  const database = { query: async (sql, values) => {
    queries.push([sql, values]);
    if (sql.includes("FROM daribar_catalog_state state")) return { rows: [{
      run_id: "run-1", generated_at: "2026-09-23T00:00:00.000Z", city: "Алматы",
      source_count: 1, normalized_count: 1, checksum: "a".repeat(64),
    }] };
    return { rows: [{ product }] };
  } };
  const snapshot = await readDaribarCatalogDatabase(database);
  assert.equal(snapshot.runId, "run-1");
  assert.equal(snapshot.products[0].sku, "SKU-DB");
  assert.equal(queries.length, 2);
});

test("provider-specific cart accepts Daribar native IDs and rejects mixed Medusa identity", () => {
  const item = { product: { id: daribarProductId("SKU-CART"), variantId: daribarVariantId("SKU-CART"),
    sku: "SKU-CART", source: "daribar" }, qty: 2 };
  assert.equal(validCartItemForProvider(item, "daribar"), true);
  assert.equal(validCartItemForProvider(item, "medusa"), false);
});

test("cutover has one batch availability route and no last_offer_count stock read", async () => {
  const [route, localRead, migration, stack] = await Promise.all([
    readFile(new URL("../src/app/api/cart/availability/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/catalog-local-read.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/migrations/025_daribar_catalog.sql", import.meta.url), "utf8"),
    readFile(new URL("../scripts/sync-daribar-stack.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(route, /requestDaribarStockQuotes/);
  assert.match(route, /lines: selected\.quote\.lines/);
  assert.doesNotMatch(localRead, /last_offer_count/);
  assert.match(migration, /active_run_id/);
  assert.match(migration, /previous_run_id/);
  assert.ok(stack.indexOf("sync-typesense-catalog") < stack.indexOf("publish-daribar-catalog"));
});

test("Typesense is deployed as a private restartable local service", async () => {
  const unit = await readFile(new URL("../deploy/systemd/typesense-server.service", import.meta.url), "utf8");
  assert.match(unit, /^ExecStart=.*--listen-address=127\.0\.0\.1.*--api-port=8108$/m);
  assert.match(unit, /^EnvironmentFile=-\/etc\/inkar-shop\/inkar-shop\.env$/m);
  assert.match(unit, /^Restart=on-failure$/m);
  assert.match(unit, /^StateDirectory=typesense$/m);
  assert.doesNotMatch(unit, /NEXT_PUBLIC|0\.0\.0\.0/);
});
