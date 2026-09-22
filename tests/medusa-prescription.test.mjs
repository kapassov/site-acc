import assert from "node:assert/strict";
import test from "node:test";
import { medusaPrescription } from "../src/lib/prescription.ts";
import { filterAndSortCatalog, parseCatalogQuery, buildCatalogFacets } from "../src/lib/catalog-query.ts";

test("Only real Medusa OTC/Rx values classify a product; polluted or absent metadata stays unknown", () => {
  assert.equal(medusaPrescription(" OTC "), false);
  assert.equal(medusaPrescription(" Rx "), true);
  for (const value of [null, undefined, "-", "none", "branded generic", "_ _", "generic", "original", "unappropriated", "БАД общеукрепляющий", false, "no"]) assert.equal(medusaPrescription(value), undefined);
});
test("Full catalog retains unknown products but the explicit OTC filter/count excludes them", () => {
  const item = (id, prescription) => ({ id, variantId: `variant_${id}`, name: id, brand: "B", categorySlug: "all", price: 100, inStock: true, priceTBD: false, prescription });
  const products = [item("unknown", undefined), item("rx", true), item("otc", false)];
  const all = filterAndSortCatalog(products, parseCatalogQuery(new URLSearchParams()));
  assert.deepEqual(all.map((p) => p.id), ["otc", "unknown", "rx"]);
  assert.deepEqual(filterAndSortCatalog(products, parseCatalogQuery(new URLSearchParams("prescription=otc"))).map((p) => p.id), ["otc"]);
  assert.deepEqual(buildCatalogFacets(products, []).prescription, { rx: 1, otc: 1 });
});
