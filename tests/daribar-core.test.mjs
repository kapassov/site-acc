import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DaribarConfigError,
  daribarCatalogTotalHint,
  daribarApiOrigin,
  daribarImageOrigin,
  isDaribarEnabled,
} from "../src/lib/daribar/config.ts";
import {
  daribarProductId,
  daribarProductSlug,
  daribarSkuFromIds,
  daribarSkuFromProductId,
  daribarSkuFromSlug,
  daribarVariantId,
} from "../src/lib/daribar/ids.ts";

function withEnv(patch, run) {
  const before = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(patch)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("Daribar feature flags are explicit and can be rolled back independently", () => {
  withEnv({ DARIBAR_ENABLED: undefined, DARIBAR_CATALOG_ENABLED: undefined }, () => {
    assert.equal(isDaribarEnabled(), false);
    assert.equal(isDaribarEnabled("catalog"), false);
  });
  withEnv({ DARIBAR_ENABLED: "true", DARIBAR_CATALOG_ENABLED: "false" }, () => {
    assert.equal(isDaribarEnabled(), true);
    assert.equal(isDaribarEnabled("catalog"), false);
    assert.equal(isDaribarEnabled("images"), true);
  });
});

test("Daribar priced-catalog total is an explicit bounded operations hint", () => {
  withEnv({ DARIBAR_CATALOG_TOTAL: "3356" }, () => {
    assert.equal(daribarCatalogTotalHint(), 3356);
  });
  withEnv({ DARIBAR_CATALOG_TOTAL: "-1" }, () => {
    assert.equal(daribarCatalogTotalHint(), 0);
  });
  withEnv({ DARIBAR_CATALOG_TOTAL: "999999999" }, () => {
    assert.equal(daribarCatalogTotalHint(), 1_000_000);
  });
});

test("Daribar origins are pinned to exact HTTPS hosts", () => {
  withEnv({
    DARIBAR_API_URL: "https://backoffice.daribar.com",
    DARIBAR_IMAGE_URL: "https://db-images.object.pscloud.io",
  }, () => {
    assert.equal(daribarApiOrigin().origin, "https://backoffice.daribar.com");
    assert.equal(daribarImageOrigin().origin, "https://db-images.object.pscloud.io");
  });
  for (const value of [
    "http://backoffice.daribar.com",
    "https://backoffice.daribar.com.evil.example",
    "https://user:pass@backoffice.daribar.com",
    "https://backoffice.daribar.com/api",
  ]) {
    withEnv({ DARIBAR_API_URL: value }, () => {
      assert.throws(() => daribarApiOrigin(), DaribarConfigError);
    });
  }
});

test("Daribar product IDs bind one validated SKU to product, variant and slug", () => {
  const sku = "SKU-123_ABC.7";
  const productId = daribarProductId(sku);
  const variantId = daribarVariantId(sku);
  const slug = daribarProductSlug("Тестовый товар с длинным названием", sku);
  assert.equal(daribarSkuFromProductId(productId), sku);
  assert.equal(daribarSkuFromIds(productId, variantId), sku);
  assert.equal(daribarSkuFromIds(productId, daribarVariantId("SKU-OTHER")), null);
  assert.equal(daribarSkuFromSlug(slug), sku);
  assert.ok(slug.length <= 199);
  assert.throws(() => daribarProductId("../../admin"), /invalid_daribar_sku/);
});

test("catalog and search retain pharmacy filters while isolating the legacy Daribar adapter", () => {
  const catalog = readFileSync("src/lib/daribar/catalog.ts", "utf8");
  const route = readFileSync("src/app/api/catalog/route.ts", "utf8");
  const search = readFileSync("src/app/api/search/route.ts", "utf8");
  const catalogView = readFileSync("src/components/catalog/CatalogView.tsx", "utf8");
  assert.match(catalog, /"\/api\/v1\/search\/keyword"/);
  assert.match(catalog, /\/api\/v1\/search\/category\?category=145/);
  assert.match(catalog, /конфиг-рацион/);
  assert.match(catalog, /"\/api\/v1\/search\/in_pharmacy"/);
  assert.match(catalog, /\/api\/media\/daribar\?sku=/);
  assert.match(route, /getMedusaCatalogPage/);
  assert.match(search, /getMedusaCatalogPage/);
  assert.match(route, /selected_pharmacy_stock/);
  assert.doesNotMatch(route, /getDaribar/);
  assert.doesNotMatch(search, /getDaribar/);
  assert.match(catalogView, /params\.append\("pharmacy", pharmacy\)/);
  assert.doesNotMatch(route, /DARIBAR_SERVICE_TOKEN/);
  assert.doesNotMatch(search, /DARIBAR_SERVICE_TOKEN/);
});
