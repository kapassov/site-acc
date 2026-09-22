import assert from "node:assert/strict";
import test from "node:test";
import {
  OTHER_CATEGORY,
  ROOT_CATEGORY,
  TOP_CATEGORIES,
  buildAssignmentPlan,
  matchMappingToProducts,
  normalizeMapping,
  validateRequiredTaxonomy,
} from "../scripts/lib/medusa-top-category-plan.mjs";

const WARE_A = "036831EA-D7C1-4DB1-B9D4-D9BA3868EF1E";
const WARE_B = "5EDD4858-66E0-461F-8A1E-48E1383D242A";

function category(id, handle, parent = null, rank = 0) {
  return {
    id,
    handle,
    name: handle,
    parent_category_id: parent,
    rank,
    is_active: true,
    is_internal: false,
  };
}

function taxonomyFixture({ includeOther = true } = {}) {
  const rows = [category(ROOT_CATEGORY.id, ROOT_CATEGORY.handle)];
  Object.values(TOP_CATEGORIES).forEach((item, index) => {
    rows.push(category(item.id, item.handle, ROOT_CATEGORY.id, index));
  });
  rows.push(category("pcat_bady_child", "bady-child", TOP_CATEGORIES.bady.id));
  if (includeOther) rows.push(category("pcat_other", OTHER_CATEGORY.handle, ROOT_CATEGORY.id, 9));
  return rows;
}

test("normalizes documented target aliases and exact UUID keys", () => {
  assert.deepEqual(normalizeMapping({
    [WARE_A.toLowerCase()]: "medicines",
    [WARE_B]: "mama-i-malysh",
  }), [
    { wareId: WARE_A, targetHandle: "lekarstva-i-bady" },
    { wareId: WARE_B, targetHandle: "mama-i-malysh" },
  ]);
  assert.throws(() => normalizeMapping({ [WARE_A]: "unknown-target" }), /Unknown targetKey/);
});

test("requires ware_id and unique SKU to resolve to the same product", () => {
  const products = [{
    id: "prod_a",
    wareId: WARE_A,
    variants: [{ id: "variant_a", sku: WARE_A }],
    categoryIds: [],
  }];
  const entries = normalizeMapping({ [WARE_A]: "bady" });
  const result = matchMappingToProducts(entries, products);
  assert.equal(result.issues.length, 0);
  assert.equal(result.assignments.get("prod_a").targetHandle, "bady");

  const mismatch = matchMappingToProducts(entries, [{
    id: "prod_a",
    wareId: WARE_A,
    variants: [{ id: "variant_a", sku: WARE_B }],
    categoryIds: [],
  }]);
  assert.equal(mismatch.assignments.size, 0);
  assert.equal(mismatch.issues[0].reason, "unmatched_ware_id_or_sku");
});

test("allows unique SKU fallback only when ware_id is empty", () => {
  const entries = normalizeMapping({ [WARE_A]: "kosmetika" });
  const result = matchMappingToProducts(entries, [{
    id: "prod_a",
    wareId: "",
    variants: [{ id: "variant_a", sku: WARE_A }],
    categoryIds: [],
  }]);
  assert.equal(result.issues.length, 0);
  assert.equal(result.assignments.get("prod_a").source, "unique_variant_sku_with_empty_ware_id");
});

test("keeps only descendants of the selected target and sends unmatched products to Other", () => {
  const validation = validateRequiredTaxonomy(taxonomyFixture());
  const products = [
    {
      id: "prod_a",
      title: "A",
      wareId: WARE_A,
      variants: [{ id: "variant_a", sku: WARE_A }],
      categoryIds: [
        ROOT_CATEGORY.id,
        TOP_CATEGORIES.bady.id,
        "pcat_bady_child",
        TOP_CATEGORIES.kosmetika.id,
      ],
    },
    {
      id: "prod_b",
      title: "B",
      wareId: WARE_B,
      variants: [{ id: "variant_b", sku: WARE_B }],
      categoryIds: [ROOT_CATEGORY.id, TOP_CATEGORIES.gigiyena.id],
    },
  ];
  const matched = matchMappingToProducts(normalizeMapping({ [WARE_A]: "bady" }), products);
  const plans = buildAssignmentPlan(products, matched.assignments, validation.taxonomy, validation.other.id);
  assert.deepEqual(plans[0].desiredCategoryIds, [
    ROOT_CATEGORY.id,
    TOP_CATEGORIES.bady.id,
    "pcat_bady_child",
  ]);
  assert.equal(plans[1].targetHandle, OTHER_CATEGORY.handle);
  assert.deepEqual(plans[1].desiredCategoryIds, [ROOT_CATEGORY.id, validation.other.id]);
});

test("rejects drift in any pinned top-level category", () => {
  const rows = taxonomyFixture();
  rows.find((row) => row.id === TOP_CATEGORIES.intim.id).handle = "wrong-handle";
  assert.throws(() => validateRequiredTaxonomy(rows), /Pinned top category mismatch/);
});
