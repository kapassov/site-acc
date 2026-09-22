export const ROOT_CATEGORY = Object.freeze({
  id: "pcat_01KSD2D1JMX8E19ANC6MZB37SK",
  handle: "site",
});

export const TOP_CATEGORIES = Object.freeze({
  bady: Object.freeze({ id: "pcat_01KSD2D1NE3KQQN9J20QRQGR63", handle: "bady" }),
  gigiyena: Object.freeze({ id: "pcat_01KSD2D1NH5JQ2M27JQD44XYSP", handle: "gigiyena" }),
  kosmetika: Object.freeze({ id: "pcat_01KSD2D1NMPEF4DWAV6H0TGVVH", handle: "kosmetika" }),
  "lekarstva-i-bady": Object.freeze({ id: "pcat_01KSD2D1NP71NK7A9ADMN0RJDE", handle: "lekarstva-i-bady" }),
  linzy: Object.freeze({ id: "pcat_01KSD2D1NSM70AT3P05K72WZ5H", handle: "linzy" }),
  "mama-i-malysh": Object.freeze({ id: "pcat_01KSD2D1NVH10V0S73EZPQ7CHY", handle: "mama-i-malysh" }),
  "med-pribory-i-izdeliya": Object.freeze({ id: "pcat_01KSD2D1P09Q0PAK58REF6SXAM", handle: "med-pribory-i-izdeliya" }),
  "sport-i-fitnes": Object.freeze({ id: "pcat_01KSD2D1P3VDXS3G56D9RP6NAA", handle: "sport-i-fitnes" }),
  intim: Object.freeze({ id: "pcat_01KSD2D1P480B7ZP4YND6AYVP6", handle: "intim" }),
});

export const OTHER_CATEGORY = Object.freeze({
  handle: "drugoe",
  name: "Другие",
  rank: 9,
});

export const PENDING_OTHER_CATEGORY_ID = "__PENDING_OTHER_CATEGORY_ID__";

const UUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[1-5][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;
const TARGET_ALIASES = new Map([
  ["bady", "bady"],
  ["supplements", "bady"],
  ["vitamins", "bady"],
  ["gigiyena", "gigiyena"],
  ["hygiene", "gigiyena"],
  ["kosmetika", "kosmetika"],
  ["cosmetics", "kosmetika"],
  ["lekarstva", "lekarstva-i-bady"],
  ["lekarstva-i-bady", "lekarstva-i-bady"],
  ["medicines", "lekarstva-i-bady"],
  ["linzy", "linzy"],
  ["lenses", "linzy"],
  ["mama-i-malysh", "mama-i-malysh"],
  ["mother-and-baby", "mama-i-malysh"],
  ["med-pribory-i-izdeliya", "med-pribory-i-izdeliya"],
  ["medical-products", "med-pribory-i-izdeliya"],
  ["sport-i-fitnes", "sport-i-fitnes"],
  ["sport", "sport-i-fitnes"],
  ["intim", "intim"],
  ["adult", "intim"],
  ["drugoe", OTHER_CATEGORY.handle],
  ["other", OTHER_CATEGORY.handle],
]);

export function normalizeIdentifier(value) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replaceAll("_x000D_", "").trim().toUpperCase();
}

export function normalizeTargetKey(value) {
  if (typeof value !== "string") throw new Error("targetKey must be a string");
  const key = value.trim().toLowerCase();
  const normalized = TARGET_ALIASES.get(key);
  if (!normalized) throw new Error(`Unknown targetKey: ${value}`);
  return normalized;
}

export function normalizeMapping(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Mapping must be a JSON object: { wareId: targetKey }");
  }
  const byWareId = new Map();
  for (const [rawWareId, rawTarget] of Object.entries(raw)) {
    const wareId = normalizeIdentifier(rawWareId);
    if (!UUID_RE.test(wareId)) throw new Error(`Invalid wareId in mapping: ${rawWareId}`);
    const targetHandle = normalizeTargetKey(rawTarget);
    const previous = byWareId.get(wareId);
    if (previous && previous !== targetHandle) {
      throw new Error(`Conflicting targetKey values for wareId ${wareId}`);
    }
    byWareId.set(wareId, targetHandle);
  }
  return [...byWareId.entries()].map(([wareId, targetHandle]) => ({ wareId, targetHandle }));
}

function uniqueById(items) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

export function buildProductIndexes(products) {
  const byWareId = new Map();
  const bySku = new Map();
  const seenProductIds = new Set();

  for (const product of products) {
    if (!product?.id || seenProductIds.has(product.id)) {
      throw new Error(`Duplicate or missing product id: ${product?.id || "<empty>"}`);
    }
    seenProductIds.add(product.id);
    const wareId = normalizeIdentifier(product.wareId ?? product?.metadata?.ware_id);
    if (wareId) {
      const matches = byWareId.get(wareId) || [];
      matches.push(product);
      byWareId.set(wareId, matches);
    }
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const compactSkus = Array.isArray(product.skus)
      ? product.skus.map((sku, index) => ({ id: `compact-${index}`, sku }))
      : variants;
    for (const variant of compactSkus) {
      const sku = normalizeIdentifier(variant?.sku);
      if (!sku) continue;
      const matches = bySku.get(sku) || [];
      matches.push({ product, variant });
      bySku.set(sku, matches);
    }
  }
  return { byWareId, bySku };
}

export function matchMappingToProducts(entries, products) {
  const indexes = buildProductIndexes(products);
  const assignments = new Map();
  const matches = [];
  const issues = [];

  for (const entry of entries) {
    const wareProducts = uniqueById(indexes.byWareId.get(entry.wareId) || []);
    const skuMatches = indexes.bySku.get(entry.wareId) || [];
    let product = null;
    let source = "";

    if (wareProducts.length === 1 && skuMatches.length === 1
        && wareProducts[0].id === skuMatches[0].product.id) {
      product = wareProducts[0];
      source = "ware_id_and_unique_variant_sku";
    } else if (wareProducts.length === 0 && skuMatches.length === 1
        && !normalizeIdentifier(skuMatches[0].product.wareId ?? skuMatches[0].product?.metadata?.ware_id)) {
      product = skuMatches[0].product;
      source = "unique_variant_sku_with_empty_ware_id";
    }

    if (!product) {
      issues.push({
        wareId: entry.wareId,
        targetHandle: entry.targetHandle,
        reason: wareProducts.length > 1 || skuMatches.length > 1
          ? "ambiguous_ware_id_or_sku"
          : wareProducts.length === 1 && skuMatches.length === 1
            ? "ware_id_sku_product_mismatch"
            : "unmatched_ware_id_or_sku",
        wareProductIds: wareProducts.map((item) => item.id),
        skuProductIds: skuMatches.map((item) => item.product.id),
      });
      continue;
    }

    const previous = assignments.get(product.id);
    if (previous && previous.targetHandle !== entry.targetHandle) {
      issues.push({
        wareId: entry.wareId,
        targetHandle: entry.targetHandle,
        reason: "conflicting_targets_for_product",
        productId: product.id,
        previousTargetHandle: previous.targetHandle,
      });
      continue;
    }
    const assignment = { productId: product.id, targetHandle: entry.targetHandle, wareId: entry.wareId, source };
    assignments.set(product.id, assignment);
    matches.push(assignment);
  }

  return { assignments, matches, issues };
}

export function buildTaxonomy(categories) {
  const byId = new Map();
  const byHandle = new Map();
  for (const category of categories) {
    if (!category?.id || !category?.handle) throw new Error("Category is missing id or handle");
    if (byId.has(category.id)) throw new Error(`Duplicate category id: ${category.id}`);
    byId.set(category.id, category);
    const handle = String(category.handle).trim().toLowerCase();
    const matches = byHandle.get(handle) || [];
    matches.push(category);
    byHandle.set(handle, matches);
  }

  function isDescendant(categoryId, ancestorId) {
    if (!categoryId || categoryId === ancestorId) return false;
    const seen = new Set();
    let current = byId.get(categoryId);
    for (let depth = 0; current && depth < 100; depth += 1) {
      const parentId = current.parent_category_id || current.parentCategoryId || null;
      if (!parentId) return false;
      if (parentId === ancestorId) return true;
      if (seen.has(parentId)) throw new Error(`Category cycle detected at ${parentId}`);
      seen.add(parentId);
      current = byId.get(parentId);
    }
    return false;
  }

  return { byId, byHandle, isDescendant };
}

export function validateRequiredTaxonomy(categories) {
  const taxonomy = buildTaxonomy(categories);
  const root = taxonomy.byId.get(ROOT_CATEGORY.id);
  if (!root || String(root.handle).toLowerCase() !== ROOT_CATEGORY.handle
      || (root.parent_category_id || root.parentCategoryId)
      || root.is_active === false || root.is_internal === true) {
    throw new Error("Medusa category root does not match the pinned site root");
  }

  for (const expected of Object.values(TOP_CATEGORIES)) {
    const category = taxonomy.byId.get(expected.id);
    if (!category || String(category.handle).toLowerCase() !== expected.handle
        || (category.parent_category_id || category.parentCategoryId) !== ROOT_CATEGORY.id
        || category.is_active === false || category.is_internal === true) {
      throw new Error(`Pinned top category mismatch: ${expected.handle} (${expected.id})`);
    }
  }

  const allowedChildren = new Set([
    ...Object.values(TOP_CATEGORIES).map((category) => category.id),
  ]);
  const otherMatches = taxonomy.byHandle.get(OTHER_CATEGORY.handle) || [];
  if (otherMatches.length > 1) throw new Error(`Multiple categories use handle ${OTHER_CATEGORY.handle}`);
  const other = otherMatches[0] || null;
  if (other) {
    if ((other.parent_category_id || other.parentCategoryId) !== ROOT_CATEGORY.id) {
      throw new Error(`${OTHER_CATEGORY.handle} exists outside the pinned site root`);
    }
    if (other.is_active === false || other.is_internal === true) {
      throw new Error(`${OTHER_CATEGORY.handle} must be active and public`);
    }
    allowedChildren.add(other.id);
  }

  const unexpectedChildren = categories.filter((category) => (
    (category.parent_category_id || category.parentCategoryId) === ROOT_CATEGORY.id
    && !allowedChildren.has(category.id)
  ));
  if (unexpectedChildren.length) {
    throw new Error(`Unexpected top-level categories: ${unexpectedChildren.map((item) => item.handle).join(", ")}`);
  }
  return { taxonomy, root, other };
}

export function desiredCategoryIds(existingIds, targetId, taxonomy) {
  const preserved = [];
  for (const id of existingIds) {
    if (taxonomy.isDescendant(id, targetId) && !preserved.includes(id)) preserved.push(id);
  }
  return [...new Set([ROOT_CATEGORY.id, targetId, ...preserved])];
}

export function equalIdSets(left, right) {
  if (left.length !== right.length) return false;
  const values = new Set(left);
  return values.size === right.length && right.every((value) => values.has(value));
}

export function buildAssignmentPlan(products, assignments, taxonomy, otherId = PENDING_OTHER_CATEGORY_ID) {
  const plans = [];
  for (const product of products) {
    const assignment = assignments.get(product.id);
    const targetHandle = assignment?.targetHandle || OTHER_CATEGORY.handle;
    const targetId = targetHandle === OTHER_CATEGORY.handle
      ? otherId
      : TOP_CATEGORIES[targetHandle]?.id;
    if (!targetId) throw new Error(`No pinned category id for target ${targetHandle}`);
    const existingIds = [...new Set((product.categoryIds
      || (Array.isArray(product.categories) ? product.categories.map((category) => category?.id) : []))
      .filter(Boolean))];
    const desiredIds = targetId === PENDING_OTHER_CATEGORY_ID
      ? [ROOT_CATEGORY.id, PENDING_OTHER_CATEGORY_ID]
      : desiredCategoryIds(existingIds, targetId, taxonomy);
    plans.push({
      productId: product.id,
      title: product.title || "",
      handle: product.handle || "",
      wareId: assignment?.wareId || normalizeIdentifier(product.wareId ?? product?.metadata?.ware_id) || null,
      mappingSource: assignment?.source || "unmatched_product_to_other",
      targetHandle,
      targetId,
      existingCategoryIds: existingIds,
      desiredCategoryIds: desiredIds,
      changed: !equalIdSets(existingIds, desiredIds),
    });
  }
  return plans;
}
