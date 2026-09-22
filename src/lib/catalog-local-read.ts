import type { CatNode, Product, ProductArtKind } from "@/lib/types";
import type { CatalogBrandFacet, CatalogFacets, CatalogQuery } from "@/lib/catalog-query";
import { catalogBrandKey } from "./catalog-query.ts";
import { medusaMediaUrl } from "./media-url.ts";
import { canonicalProductSlug, normalizeProductIdentity } from "./product-normalization.ts";
import { productImageFallback } from "./product-image-overrides.ts";
import { medusaKnownPriceSql, medusaStockMetadata, medusaStockPriceSql } from "./medusa-stock.ts";
import { exactKzt } from "./money.ts";
import { medusaPrescription } from "./prescription.ts";
import { withRegistryCoordinates } from "./pharmacy-coordinate-registry.ts";
import type { CanonicalCheckoutItem } from "./checkoutItems.ts";

type CategoryItem = { id?: unknown; handle?: unknown; is_primary?: unknown };
type ImageItem = { url?: unknown };
type VariantItem = {
  id?: unknown;
  title?: unknown;
  sku?: unknown;
  barcode?: unknown;
  price?: unknown;
  original_price?: unknown;
};
type ProductRow = {
  id: string;
  handle: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  brand: string | null;
  manufacturer: string | null;
  country: string | null;
  mnn: string | null;
  atc: string | null;
  rx_otc: string | null;
  min_price: number | string | null;
  stock_pharmacy_count: number | string | null;
  categories: CategoryItem[] | null;
  images: ImageItem[] | null;
  variants: VariantItem[] | null;
  metadata: Record<string, unknown> | null;
};
type RunRow = {
  status: string;
  expected_products: unknown;
  processed_products: unknown;
  metrics: Record<string, unknown> | null;
};
type CategoryRow = { id: string; handle: string | null; name: string; parent_id: string | null; rank: number };
type FacetAggregateRow = {
  count: unknown;
  brands: unknown;
  categories: unknown;
  min_price: unknown;
  max_price: unknown;
  known_price_count: unknown;
  in_stock_count: unknown;
  sale_count: unknown;
  rx_count: unknown;
  otc_count: unknown;
};
type LocalPool = import("pg").Pool;
type LocalClient = import("pg").PoolClient;

const root = globalThis as typeof globalThis & { __inkarStorefrontReadPool?: Promise<LocalPool> };
const PRODUCT_COLUMNS = `
  id, handle, title, description, thumbnail_url, brand, manufacturer, country,
  mnn, atc, rx_otc, min_price, stock_pharmacy_count, categories, images, variants, metadata
`;

function text(value: unknown): string | undefined {
  if (value == null) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function price(value: unknown): number | null {
  const normalized = exactKzt(value);
  return normalized > 0 ? normalized : null;
}

function art(title: string): { kind: ProductArtKind; hue: number } {
  const kinds: ProductArtKind[] = ["bottle", "tube", "jar", "box", "dropper", "spray"];
  let hash = 0;
  for (let index = 0; index < title.length; index += 1) hash = (hash * 31 + title.charCodeAt(index)) >>> 0;
  return { kind: kinds[hash % kinds.length], hue: hash % 360 };
}

function volume(title: string): string | undefined {
  return title.match(/\b\d+(?:[.,]\d+)?\s*(?:мл|мг|г|шт|капс\.?|таб\.?)\b/i)?.[0];
}

function mapRow(row: ProductRow, includeGallery = false): Product {
  const categories = (Array.isArray(row.categories) ? row.categories : []).filter((category) => !["site", "root", "website"].includes(String(category.handle || "").toLowerCase()));
  const primary = categories.find((category) => category.is_primary === true) || categories[0];
  const handles = categories.map((category) => text(category.handle)).filter(Boolean) as string[];
  const imageUrls = [...new Set([
    medusaMediaUrl(row.thumbnail_url),
    ...(Array.isArray(row.images) ? row.images.map((image) => medusaMediaUrl(image.url)) : []),
  ].filter(Boolean) as string[])];
  const fallbackImage = imageUrls.length ? undefined : productImageFallback(row.id);
  const resolvedImageUrls = fallbackImage ? [fallbackImage] : imageUrls;
  const variants = (Array.isArray(row.variants) ? row.variants : []).flatMap((variant) => {
    const id = text(variant.id);
    if (!id) return [];
    return [{
      id,
      title: text(variant.title) || row.title,
      sku: text(variant.sku),
      barcode: text(variant.barcode),
      price: price(variant.price) ?? undefined,
      originalPrice: price(variant.original_price),
    }];
  });
  const stock = medusaStockMetadata(row.metadata);
  const currentPrice = stock.price;
  const pricedVariant = variants.find((variant) => variant.price === currentPrice);
  const oldPrice = pricedVariant?.originalPrice && currentPrice && pricedVariant.originalPrice > currentPrice
    ? pricedVariant.originalPrice
    : undefined;
  const prescription = medusaPrescription(row.rx_otc);
  const rx = prescription === true;
  const identity = normalizeProductIdentity({
    name: row.title,
    brand: text(row.brand),
    barcode: variants[0]?.barcode,
    slug: row.handle,
  });
  return {
    id: row.id,
    source: "medusa",
    sku: variants[0]?.sku,
    wareId: text(row.metadata?.ware_id),
    stockSourceDate: stock.sourceDate,
    stockValidUntil: text(row.metadata?.standard_n_valid_until),
    stockStale: stock.stale,
    slug: canonicalProductSlug(identity.name, row.handle),
    name: identity.name,
    brand: identity.brand || "—",
    categorySlug: text(primary?.handle) || "",
    categoryHandles: handles,
    price: currentPrice ?? 0,
    oldPrice,
    priceTBD: currentPrice === null,
    rating: 0,
    reviews: 0,
    volume: volume(identity.name),
    badges: rx ? ["rx"] : [],
    art: art(identity.name),
    image: resolvedImageUrls[0],
    images: resolvedImageUrls.length ? (includeGallery ? resolvedImageUrls : resolvedImageUrls.slice(0, 1)) : undefined,
    description: text(row.description),
    inStock: stock.inStock,
    stockPharmacies: stock.stockPharmacies,
    prescription,
    manufacturer: text(row.manufacturer),
    country: text(row.country),
    mnn: text(row.mnn),
    atc: text(row.atc),
    barcode: variants[0]?.barcode,
    variantId: variants[0]?.id,
    variants: variants.length
      ? variants.map((variant) => ({
          id: variant.id,
          title: variant.title,
          sku: variant.sku,
          barcode: variant.barcode,
          price: variant.price,
        }))
      : undefined,
  };
}

async function pool(): Promise<LocalPool> {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
  if (!connectionString) throw new Error("catalog_database_not_configured");
  if (root.__inkarStorefrontReadPool) return root.__inkarStorefrontReadPool;
  const promise = import("pg").then(({ Pool }) => {
    const ssl = /sslmode=require|neon\.tech|supabase|render\.com|amazonaws\.com/i.test(connectionString)
      ? { rejectUnauthorized: true }
      : undefined;
    const instance = new Pool({
      connectionString,
      ssl,
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 12_000,
      application_name: "inkar-storefront-read",
    });
    instance.on("error", (error) => console.error("Unexpected storefront database error", error));
    return instance;
  });
  root.__inkarStorefrontReadPool = promise;
  void promise.catch(() => {
    if (root.__inkarStorefrontReadPool === promise) delete root.__inkarStorefrontReadPool;
  });
  return promise;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function verifiedSnapshotExpected(row: RunRow | undefined): number | null {
  const expected = integer(row?.expected_products);
  const processed = integer(row?.processed_products);
  const metrics = row?.metrics;
  if (!row || row.status !== "completed" || expected === null || processed !== expected
      || !metrics || Array.isArray(metrics) || metrics.complete !== true
      || metrics.start_offset !== 0 || metrics.started_offset !== 0 || metrics.limit !== null) {
    return null;
  }
  return expected;
}

async function verifySnapshot(client: LocalClient): Promise<number> {
  const run = await client.query<RunRow>(`
    SELECT status, expected_products, processed_products, metrics
    FROM catalog_import_runs
    WHERE status = 'completed'
      AND expected_products = processed_products
      AND jsonb_typeof(metrics) = 'object'
      AND metrics @> '{"complete":true,"start_offset":0,"started_offset":0,"limit":null}'::jsonb
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `);
  const expected = verifiedSnapshotExpected(run.rows[0]);
  if (expected === null) throw new Error("catalog_snapshot_incomplete");
  const count = await client.query<{ active_count: unknown }>(`
    SELECT count(*)::integer AS active_count FROM catalog_products WHERE active
  `);
  if (integer(count.rows[0]?.active_count) !== expected) throw new Error("catalog_snapshot_incomplete");
  return expected;
}

async function verifiedRead<T>(read: (client: LocalClient, expected: number) => Promise<T>): Promise<T> {
  const client = await (await pool()).connect();
  let transaction = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transaction = true;
    const expected = await verifySnapshot(client);
    const result = await read(client, expected);
    await client.query("COMMIT");
    transaction = false;
    return result;
  } catch (error) {
    if (transaction) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function boundedLimit(value: number, fallback = 250): number {
  return Math.max(1, Math.min(250, Number.isSafeInteger(value) ? value : fallback));
}

export async function getLocalProductsPage(limit = 250): Promise<Product[]> {
  return verifiedRead(async (client) => {
    const result = await client.query<ProductRow>(`
      SELECT ${PRODUCT_COLUMNS}
      FROM catalog_product_read_model
      WHERE active
      ORDER BY id
      LIMIT $1
    `, [boundedLimit(limit)]);
    return result.rows.map((row) => mapRow(row));
  });
}

export async function getLocalProduct(handle: string): Promise<Product | null> {
  return verifiedRead(async (client) => {
    const result = await client.query<ProductRow>(`
      SELECT ${PRODUCT_COLUMNS}
      FROM catalog_product_read_model
      WHERE active AND (lower(handle) = lower($1) OR id = $1)
      LIMIT 1
    `, [handle]);
    return result.rows[0] ? mapRow(result.rows[0], true) : null;
  });
}

function escapedLike(query: string): string {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}

function singleSubstitutionPatterns(query: string): string[] {
  const tokens = (query.match(/[\p{L}]{4,32}/gu) || [])
    .sort((left, right) => right.length - left.length)
    .slice(0, 3);
  const patterns = new Set<string>();
  for (const token of tokens) {
    const chars = [...token];
    for (let index = 0; index < chars.length; index += 1) {
      const before = chars.slice(0, index).join("").replace(/[\\%_]/g, "\\$&");
      const after = chars.slice(index + 1).join("").replace(/[\\%_]/g, "\\$&");
      patterns.add(`%${before}_${after}%`);
      if (index < chars.length - 1 && chars[index] !== chars[index + 1]) {
        const swapped = [...chars];
        [swapped[index], swapped[index + 1]] = [swapped[index + 1], swapped[index]];
        patterns.add(`%${swapped.join("").replace(/[\\%_]/g, "\\$&")}%`);
      }
    }
  }
  return [...patterns];
}

export async function searchLocalProducts(query: string, limit = 40): Promise<Product[]> {
  return verifiedRead(async (client) => {
    const result = await client.query<ProductRow>(`
      SELECT ${PRODUCT_COLUMNS}
      FROM catalog_product_read_model
      WHERE active AND concat_ws(' ', title, brand, mnn, atc, manufacturer, variants::text)
        ILIKE $1 ESCAPE '\\'
      ORDER BY title, id
      LIMIT $2
    `, [escapedLike(query), boundedLimit(limit, 40)]);
    return result.rows.map((row) => mapRow(row));
  });
}

export type CatalogTitleCandidate = { id: string; title: string };
type CatalogTitleRow = CatalogTitleCandidate & {
  handle: string;
  brand: string | null;
  variants: VariantItem[] | null;
};

/** Cheap generation token used to keep the prepared title index until an atomic import changes it. */
export async function getLocalCatalogTitleRevision(): Promise<string> {
  return verifiedRead(async (client) => {
    const result = await client.query<{ id: string }>(`
      SELECT id
      FROM catalog_import_runs
      WHERE source = 'medusa_standardn' AND status = 'completed'
      ORDER BY started_at DESC, id DESC
      LIMIT 1
    `);
    const revision = text(result.rows[0]?.id);
    if (!revision) throw new Error("catalog_title_revision_unavailable");
    return revision;
  });
}

/** Lightweight, verified identity index. No price or stock may come from search ranking. */
export async function getLocalCatalogTitles(): Promise<CatalogTitleCandidate[]> {
  return verifiedRead(async (client) => {
    const rows = (await client.query<CatalogTitleRow>(`
      SELECT id, handle, title, brand, variants
      FROM catalog_product_read_model
      WHERE active
      ORDER BY id
    `)).rows;
    return rows.map((row) => ({
      id: row.id,
      // The search title must be identical to the identity shown on the card.
      // Some verified source rows need a barcode-bound spelling repair.
      title: normalizeProductIdentity({
        name: row.title,
        brand: text(row.brand),
        barcode: text(row.variants?.[0]?.barcode),
        slug: row.handle,
      }).name,
    }));
  });
}

/**
 * PostgreSQL is used only as a lightweight title index. The returned ids are
 * hydrated from Medusa before any product data reaches the storefront.
 */
export async function searchLocalProductTitleCandidates(
  query: string,
  limit = 40,
): Promise<CatalogTitleCandidate[]> {
  return verifiedRead(async (client) => {
    const bounded = boundedLimit(limit, 40);
    // Keep the common literal path entirely on the GIN indexes. Mixing
    // word_similarity() into this query makes PostgreSQL scan the complete
    // 285k-row catalogue even when the exact title is already known.
    const literal = await client.query<CatalogTitleCandidate>(`
      SELECT id, title
      FROM catalog_products
      WHERE active AND (
        search_vector @@ plainto_tsquery('russian', $1)
        OR title ILIKE $2 ESCAPE '\\'
      )
      ORDER BY
        CASE WHEN title ILIKE $2 ESCAPE '\\' THEN 0 ELSE 1 END,
        title,
        id
      LIMIT $3
    `, [query, escapedLike(query), bounded]);
    if (literal.rows.length) return literal.rows;

    const result = await client.query<CatalogTitleCandidate>(`
      SELECT id, title
      FROM catalog_products
      WHERE active AND (
        title ILIKE $1 ESCAPE '\\'
        OR word_similarity($2, title) >= 0.42
        OR similarity($2, split_part(title, ' ', 1)) >= 0.35
        OR title ILIKE ANY($3::text[])
      )
      ORDER BY
        CASE
          WHEN title ILIKE $1 ESCAPE '\\' THEN 0
          WHEN title ILIKE ANY($3::text[]) THEN 1
          ELSE 2
        END,
        greatest(
          word_similarity($2, title),
          similarity($2, split_part(title, ' ', 1))
        ) DESC,
        title,
        id
      LIMIT $4
    `, [escapedLike(query), query, singleSubstitutionPatterns(query), bounded]);
    return result.rows;
  });
}

function brandKey(value: string): string {
  return catalogBrandKey(value);
}

export async function getLocalBrandProducts(slug: string, limit = 250): Promise<Product[]> {
  return verifiedRead(async (client) => {
    const brands = await client.query<{ brand: string }>(`
      SELECT brand FROM catalog_products
      WHERE active AND brand IS NOT NULL AND btrim(brand) <> ''
        AND btrim(brand) NOT IN ('-', '—', '_')
      GROUP BY brand ORDER BY brand LIMIT 5000
    `);
    const brand = brands.rows.find((row) => brandKey(row.brand) === slug)?.brand;
    if (!brand) return [];
    const result = await client.query<ProductRow>(`
      SELECT ${PRODUCT_COLUMNS}
      FROM catalog_product_read_model
      WHERE active AND brand = $1
      ORDER BY id
      LIMIT $2
    `, [brand, boundedLimit(limit)]);
    return result.rows.map((row) => mapRow(row));
  });
}

export async function getLocalBrandCounts(limit = 250): Promise<Array<{ name: string; count: number }>> {
  return verifiedRead(async (client) => {
    const result = await client.query<{ name: string; count: unknown }>(`
      SELECT brand AS name, count(*)::integer AS count
      FROM catalog_products
      WHERE active AND brand IS NOT NULL AND btrim(brand) <> ''
        AND btrim(brand) NOT IN ('-', '—', '_')
      GROUP BY brand
      ORDER BY count(*) DESC, brand
      LIMIT $1
    `, [boundedLimit(limit, 250)]);
    return result.rows.flatMap((row) => {
      const count = integer(row.count);
      return count == null ? [] : [{ name: row.name, count }];
    });
  });
}

export async function getLocalCategoryProducts(
  handle: string,
  limit = 60,
): Promise<{ products: Product[]; count: number }> {
  return verifiedRead(async (client) => {
    const params = [handle, boundedLimit(limit, 60)];
    const products = await client.query<ProductRow>(`
      WITH RECURSIVE selected_categories AS (
        SELECT id FROM catalog_categories WHERE active AND lower(handle) = lower($1)
        UNION
        SELECT child.id FROM catalog_categories child
        JOIN selected_categories parent ON child.parent_id = parent.id
        WHERE child.active
      )
      SELECT ${PRODUCT_COLUMNS.replaceAll(/\b(id|handle|active)\b/g, "read.$1")}
      FROM catalog_product_read_model read
      WHERE read.active AND EXISTS (
        SELECT 1 FROM catalog_product_categories link
        JOIN selected_categories selected ON selected.id = link.category_id
        WHERE link.product_id = read.id
      )
      ORDER BY read.id
      LIMIT $2
    `, params);
    const count = await client.query<{ count: unknown }>(`
      WITH RECURSIVE selected_categories AS (
        SELECT id FROM catalog_categories WHERE active AND lower(handle) = lower($1)
        UNION
        SELECT child.id FROM catalog_categories child
        JOIN selected_categories parent ON child.parent_id = parent.id
        WHERE child.active
      )
      SELECT count(DISTINCT link.product_id)::integer AS count
      FROM catalog_product_categories link
      JOIN selected_categories selected ON selected.id = link.category_id
      JOIN catalog_products product ON product.id = link.product_id AND product.active
    `, [handle]);
    return { products: products.rows.map((row) => mapRow(row)), count: integer(count.rows[0]?.count) ?? 0 };
  });
}

const TECHNICAL_HANDLES = new Set(["site", "root", "website"]);

export function buildCategoryTree(rows: CategoryRow[]): CatNode[] {
  const knownIds = new Set(rows.map((row) => row.id));
  const byParent = new Map<string | null, CategoryRow[]>();
  for (const row of rows) {
    const parent = row.parent_id && knownIds.has(row.parent_id) ? row.parent_id : null;
    const siblings = byParent.get(parent) || [];
    siblings.push(row);
    byParent.set(parent, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name, "ru"));
  }
  const map = (items: CategoryRow[], path: Set<string>, depth: number): CatNode[] => {
    if (depth > 12) return [];
    return items.flatMap((row) => {
      const handle = text(row.handle);
      if (!handle || path.has(row.id)) return [];
      return [{ id: row.id, handle, name: row.name, children: map(byParent.get(row.id) || [], new Set(path).add(row.id), depth + 1) }];
    });
  };
  const technicalRoots = rows.filter((row) => TECHNICAL_HANDLES.has(String(row.handle || "").toLowerCase()));
  const roots = technicalRoots.length
    ? technicalRoots.flatMap((row) => byParent.get(row.id) || [])
    : (byParent.get(null) || []).filter((row) => !TECHNICAL_HANDLES.has(String(row.handle || "").toLowerCase()));
  return map(roots, new Set(technicalRoots.map((row) => row.id)), 0);
}

export async function getLocalCategoryTree(): Promise<CatNode[]> {
  return verifiedRead(async (client) => {
    const result = await client.query<CategoryRow>(`
      SELECT id, handle, name, parent_id, rank
      FROM catalog_categories WHERE active
      ORDER BY rank, name, id
    `);
    return buildCategoryTree(result.rows);
  });
}

function jsonObjects(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => (
    Boolean(item) && typeof item === "object" && !Array.isArray(item)
  ));
  if (typeof value !== "string") return [];
  try {
    return jsonObjects(JSON.parse(value));
  } catch {
    return [];
  }
}

export function mergeLocalBrandFacets(value: unknown): CatalogBrandFacet[] {
  const byKey = new Map<string, { name: string; count: number }>();
  for (const item of jsonObjects(value)) {
    const name = text(item.name);
    const count = integer(item.count);
    if (!name || count == null || count === 0 || ["-", "вЂ”", "_"].includes(name)) continue;
    const key = brandKey(name);
    const current = byKey.get(key);
    if (current) current.count += count;
    else byKey.set(key, { name, count });
  }
  return [...byKey.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "ru"));
}

export function localCatalogFacetsFromRow(row: FacetAggregateRow | undefined): {
  count: number;
  facets: CatalogFacets;
} {
  const count = integer(row?.count) ?? 0;
  const knownPrices = integer(row?.known_price_count) ?? 0;
  const inStock = integer(row?.in_stock_count) ?? 0;
  const sale = integer(row?.sale_count) ?? 0;
  const rx = integer(row?.rx_count) ?? 0;
  const otc = integer(row?.otc_count) ?? 0;
  const categories = jsonObjects(row?.categories).flatMap((item) => {
    const id = text(item.id);
    const slug = text(item.slug);
    const name = text(item.name);
    const categoryCount = integer(item.count);
    return id && slug && name && categoryCount != null
      ? [{ id, slug, name, count: categoryCount }]
      : [];
  });
  return {
    count,
    facets: {
      categories,
      brands: mergeLocalBrandFacets(row?.brands),
      price: {
        min: price(row?.min_price),
        max: price(row?.max_price),
        unknown: Math.max(0, count - knownPrices),
      },
      // There is no authoritative negative stock feed in the current model.
      // A positive variant/pharmacy price confirms availability; otherwise the
      // product remains unknown rather than being reported out of stock.
      availability: { inStock, outOfStock: 0, unknown: Math.max(0, count - inStock) },
      sale: { onSale: sale, regular: Math.max(0, count - sale) },
      prescription: { rx, otc },
    },
  };
}

export function buildFullCatalogFacetsSql(
  categoryCte: string,
  priceJoins: string,
  catalogPrice: string,
  availabilityPrice: string,
  filter: string,
): string {
  const withPrefix = categoryCte ? `${categoryCte},` : "WITH RECURSIVE";
  return `${withPrefix}
    filtered_products AS MATERIALIZED (
      SELECT
        product.id,
        product.brand,
        product.rx_otc,
        ${catalogPrice} AS catalog_price,
        ${availabilityPrice} AS availability_price,
        EXISTS (
          SELECT 1 FROM catalog_variants sale_variant
          WHERE sale_variant.product_id = product.id AND sale_variant.active
            AND sale_variant.price_amount > 0
            AND sale_variant.original_price_amount > sale_variant.price_amount
        ) AS on_sale
      FROM catalog_products product
      ${priceJoins}
      WHERE ${filter}
    ),
    technical_roots AS MATERIALIZED (
      SELECT id
      FROM catalog_categories
      WHERE active AND lower(coalesce(handle, '')) IN ('site', 'root', 'website')
    ),
    top_level_categories AS MATERIALIZED (
      SELECT category.id, category.handle, category.name, category.rank
      FROM catalog_categories category
      WHERE category.active
        AND category.handle IS NOT NULL
        AND btrim(category.handle) <> ''
        AND lower(category.handle) NOT IN ('site', 'root', 'website')
        AND (
          category.parent_id IN (SELECT id FROM technical_roots)
          OR (
            NOT EXISTS (SELECT 1 FROM technical_roots)
            AND NOT EXISTS (
              SELECT 1 FROM catalog_categories parent
              WHERE parent.id = category.parent_id AND parent.active
            )
          )
        )
    ),
    category_descendants(ancestor_id, descendant_id) AS (
      SELECT id, id FROM top_level_categories
      UNION
      SELECT tree.ancestor_id, child.id
      FROM category_descendants tree
      JOIN catalog_categories child ON child.parent_id = tree.descendant_id
      WHERE child.active
    ),
    category_counts AS (
      SELECT tree.ancestor_id, count(DISTINCT filtered.id)::integer AS count
      FROM category_descendants tree
      JOIN catalog_product_categories link ON link.category_id = tree.descendant_id
      JOIN filtered_products filtered ON filtered.id = link.product_id
      GROUP BY tree.ancestor_id
    ),
    brand_counts AS MATERIALIZED (
      SELECT btrim(brand) AS name, count(*)::integer AS count
      FROM filtered_products
      WHERE brand IS NOT NULL AND btrim(brand) <> ''
        AND btrim(brand) NOT IN ('-', 'вЂ”', '_')
      GROUP BY btrim(brand)
      ORDER BY count(*) DESC, btrim(brand)
      FETCH FIRST 160 ROWS ONLY
    ),
    facet_totals AS (
      SELECT
        count(*)::integer AS count,
        min(catalog_price) AS min_price,
        max(catalog_price) AS max_price,
        count(catalog_price)::integer AS known_price_count,
        count(*) FILTER (WHERE availability_price IS NOT NULL)::integer AS in_stock_count,
        count(*) FILTER (WHERE on_sale)::integer AS sale_count,
        count(*) FILTER (WHERE lower(btrim(coalesce(rx_otc, ''))) = 'rx')::integer AS rx_count,
        count(*) FILTER (WHERE lower(btrim(coalesce(rx_otc, ''))) = 'otc')::integer AS otc_count
      FROM filtered_products
    )
    SELECT
      totals.*,
      coalesce((
        SELECT jsonb_agg(
          jsonb_build_object('name', brands.name, 'count', brands.count)
          ORDER BY brands.count DESC, brands.name
        )
        FROM brand_counts brands
      ), '[]'::jsonb) AS brands,
      coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', category.id,
            'slug', category.handle,
            'name', category.name,
            'count', coalesce(counts.count, 0)
          )
          ORDER BY category.rank, category.name, category.id
        )
        FROM top_level_categories category
        LEFT JOIN category_counts counts ON counts.ancestor_id = category.id
      ), '[]'::jsonb) AS categories
    FROM facet_totals totals`;
}

export type LocalCatalogQueryPage = {
  products: Product[];
  count: number;
  catalogTotal: number;
  facets?: CatalogFacets;
};

export type LocalPickupOption = {
  sourceCode: string;
  name: string;
  city: string;
  address: string;
  hours: string;
  total: number;
  lat?: number;
  lon?: number;
};

type PickupOptionRow = {
  source_code: string;
  name: string;
  city: string;
  address: string;
  hours: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  total: string | number;
};

/** Return only pharmacies that can fulfil every requested cart line now. */
export async function findLocalPickupOptions(
  items: CanonicalCheckoutItem[],
  city?: string,
  limit = 600,
): Promise<LocalPickupOption[]> {
  if (!Array.isArray(items) || items.length < 1 || items.length > 30
      || items.some((item) => !/^prod_[A-Za-z0-9]+$/.test(item.productId)
        || !/^variant_[A-Za-z0-9]+$/.test(item.variantId)
        || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)) {
    throw new Error("invalid_pickup_items");
  }
  const normalizedCity = String(city || "").trim();
  if (normalizedCity && !/^[\p{L}\p{M} .'-]{1,100}$/u.test(normalizedCity)) {
    throw new Error("invalid_pickup_city");
  }
  const bounded = Math.max(1, Math.min(600, Number.isSafeInteger(limit) ? limit : 600));
  return verifiedRead(async (client) => {
    const result = await client.query<PickupOptionRow>(`
      WITH requested(product_id, variant_id, quantity) AS (
        SELECT * FROM unnest($1::text[], $2::text[], $3::integer[])
      ), eligible AS (
        SELECT offer.pharmacy_id,
          sum(offer.price_decimal * requested.quantity)::numeric AS total,
          count(*)::integer AS matched
        FROM requested
        JOIN catalog_products product
          ON product.id = requested.product_id AND product.active
        JOIN catalog_pharmacy_offers offer
          ON offer.product_id = requested.product_id
          AND offer.variant_id = requested.variant_id
        JOIN catalog_pharmacies pharmacy
          ON pharmacy.id = offer.pharmacy_id AND pharmacy.active
        WHERE offer.in_stock
          AND offer.source_quantity >= requested.quantity
          AND offer.price_decimal > 0
          AND offer.source_updated_at >= now() - interval '72 hours'
          AND offer.source_snapshot_id = product.metadata->>'standard_n_snapshot_id'
          AND ($4::text = '' OR lower(pharmacy.city) = lower($4))
        GROUP BY offer.pharmacy_id
        HAVING count(*) = $5::integer
      )
      SELECT pharmacy.id AS source_code, pharmacy.name,
        coalesce(pharmacy.city, '') AS city,
        coalesce(pharmacy.address, pharmacy.name) AS address,
        pharmacy.metadata->>'hours' AS hours,
        pharmacy.latitude, pharmacy.longitude, eligible.total
      FROM eligible
      JOIN catalog_pharmacies pharmacy ON pharmacy.id = eligible.pharmacy_id
      ORDER BY eligible.total, pharmacy.name, pharmacy.id
      LIMIT $6
    `, [
      items.map((item) => item.productId),
      items.map((item) => item.variantId),
      items.map((item) => item.quantity),
      normalizedCity,
      items.length,
      bounded,
    ]);
    return result.rows.flatMap((row) => {
      const total = exactKzt(row.total);
      const latitude = row.latitude == null ? undefined : Number(row.latitude);
      const longitude = row.longitude == null ? undefined : Number(row.longitude);
      if (!/^sloc_[A-Za-z0-9]+$/.test(row.source_code) || total <= 0
          || !row.city.trim() || !row.address.trim()) return [];
      return [withRegistryCoordinates({
        sourceCode: row.source_code,
        name: row.name,
        city: row.city,
        address: row.address,
        hours: row.hours || "",
        total,
        lat: Number.isFinite(latitude) ? latitude : undefined,
        lon: Number.isFinite(longitude) ? longitude : undefined,
      })];
    });
  });
}

export function catalogQueryNeedsPrice(query: CatalogQuery): boolean {
  return query.includeFacets
    || query.minPrice != null
    || query.maxPrice != null
    || query.inStock
    || query.sort === "price_asc"
    || query.sort === "price_desc";
}

export async function queryLocalCatalog(query: CatalogQuery, options: { productIds?: string[]; pharmacies?: string[] } = {}): Promise<LocalCatalogQueryPage> {
  return verifiedRead(async (client, expected) => {
    const values: unknown[] = [];
    const where = ["product.active"];
    let categoryCte = "";
    const parameter = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    // Only the validated current Standard N snapshot is eligible, including
    // exact tiyn prices. Legacy price-only caches are never a stock source.
    const selected = options.pharmacies?.length ? parameter(options.pharmacies) : null;
    const availabilityJoin = selected ? `JOIN (
      SELECT offer.product_id, min(offer.price_decimal) AS min_price
      FROM catalog_pharmacy_offers offer
      JOIN catalog_products source_product ON source_product.id = offer.product_id
      JOIN catalog_pharmacies pharmacy ON pharmacy.id = offer.pharmacy_id AND pharmacy.active
      WHERE offer.pharmacy_id = ANY(${selected}::text[])
        AND offer.in_stock AND offer.source_quantity >= 1 AND offer.price_decimal > 0
        AND offer.source_updated_at >= now() - interval '72 hours'
        AND offer.source_snapshot_id = source_product.metadata->>'standard_n_snapshot_id'
        AND ${medusaStockPriceSql("source_product")} IS NOT NULL
      GROUP BY offer.product_id
    ) selected_offer ON selected_offer.product_id = product.id` : `JOIN catalog_offer_sync_state storefront_offer_state
      ON storefront_offer_state.product_id = product.id
     AND storefront_offer_state.last_success_at IS NOT NULL
     AND storefront_offer_state.last_offer_count > 0`;
    // The mapping table enforces one enabled row per product/variant and the
    // imported ASS catalogue currently has one active mapped variant per
    // product, so a direct indexed join avoids a global DISTINCT scan.
    const priceJoins = `${availabilityJoin}
      JOIN daribar_delivery_product_mappings storefront_product_mapping
        ON storefront_product_mapping.product_id = product.id
       AND storefront_product_mapping.enabled`;
    // Catalogue pages may show the last dated price. Pharmacy-constrained
    // reads (checkout) continue to require a fresh stock/price snapshot.
    const catalogPrice = selected ? "selected_offer.min_price" : medusaKnownPriceSql();
    // A dated price may remain useful after stock expires, but it must never
    // become proof of availability. For the public catalogue only the guarded
    // Standard N stock expression can confirm availability; selected-pharmacy
    // reads already require a fresh matching offer above.
    const availabilityPrice = selected ? "selected_offer.min_price" : medusaStockPriceSql();
    let relevanceOrder = "";

    where.push(`${catalogPrice} IS NOT NULL`);

    if (options.productIds) {
      const ids = parameter(options.productIds);
      where.push(`product.id = ANY(${ids}::text[])`);
      relevanceOrder = `array_position(${ids}::text[], product.id),`;
    } else if (query.q) {
      const plain = parameter(query.q);
      const like = parameter(escapedLike(query.q));
      const typoPatterns = query.q.trim().length >= 4 ? parameter(singleSubstitutionPatterns(query.q)) : null;
      const fuzzy = query.q.trim().length >= 4
        ? `OR word_similarity(${plain}, product.title) >= 0.62
           OR product.title ILIKE ANY(${typoPatterns})
           OR word_similarity(${plain}, coalesce(product.brand, '')) >= 0.72
           OR word_similarity(${plain}, coalesce(product.mnn, '')) >= 0.72`
        : "";
      where.push(`(
        product.search_vector @@ plainto_tsquery('russian', ${plain})
        OR product.title ILIKE ${like} ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM catalog_variants searched_variant
          WHERE searched_variant.product_id = product.id AND searched_variant.active
            AND (searched_variant.sku ILIKE ${like} ESCAPE '\\' OR searched_variant.barcode ILIKE ${like} ESCAPE '\\')
        )
        ${fuzzy}
      )`);
      relevanceOrder = `
        CASE
          WHEN product.title ILIKE ${like} ESCAPE '\\' THEN 0
          WHEN product.search_vector @@ plainto_tsquery('russian', ${plain}) THEN 1
          ELSE 2
        END,
        word_similarity(${plain}, product.title) DESC,
      `;
    }
    if (query.category) {
      const category = parameter(query.category);
      categoryCte = `WITH RECURSIVE selected_categories AS (
        SELECT id FROM catalog_categories WHERE active AND lower(handle) = lower(${category})
        UNION
        SELECT child.id FROM catalog_categories child
        JOIN selected_categories parent ON child.parent_id = parent.id
        WHERE child.active
      )`;
      where.push(`EXISTS (
        SELECT 1 FROM catalog_product_categories link
        JOIN selected_categories selected ON selected.id = link.category_id
        WHERE link.product_id = product.id
      )`);
    }
    if (query.brands.length) {
      const brands = await client.query<{ brand: string }>(`
        SELECT brand FROM catalog_products
        WHERE active AND brand IS NOT NULL AND btrim(brand) <> ''
          AND btrim(brand) NOT IN ('-', '—', '_')
        GROUP BY brand ORDER BY brand LIMIT 5000
      `);
      const requested = new Set(query.brands);
      const names = brands.rows.filter((row) => requested.has(brandKey(row.brand))).map((row) => row.brand);
      if (!names.length) where.push("false");
      else where.push(`product.brand = ANY(${parameter(names)}::text[])`);
    }
    if (query.minPrice != null) where.push(`${catalogPrice} >= ${parameter(query.minPrice)}`);
    if (query.maxPrice != null) where.push(`${catalogPrice} <= ${parameter(query.maxPrice)}`);
    if (query.inStock) where.push(`${availabilityPrice} IS NOT NULL`);
    if (query.sale) {
      where.push(`EXISTS (
        SELECT 1 FROM catalog_variants sale_variant
        WHERE sale_variant.product_id = product.id AND sale_variant.active
          AND sale_variant.price_amount > 0
          AND sale_variant.original_price_amount > sale_variant.price_amount
      )`);
    }
    if (query.prescription === "rx") where.push("lower(btrim(coalesce(product.rx_otc, ''))) = 'rx'");
    if (query.prescription === "otc") where.push("lower(btrim(coalesce(product.rx_otc, ''))) = 'otc'");

    const priceOrder = catalogPrice;
    const baseOrder = query.sort === "name_asc" ? "product.title ASC, product.id ASC"
      : query.sort === "name_desc" ? "product.title DESC, product.id ASC"
      : query.sort === "price_asc" ? `${priceOrder} ASC NULLS LAST, product.id ASC`
      : query.sort === "price_desc" ? `${priceOrder} DESC NULLS LAST, product.id ASC`
      : query.q ? `${relevanceOrder} product.id ASC`
      : "product.id ASC";
    const orderabilityOrder = `CASE WHEN ${availabilityPrice} IS NOT NULL
      AND lower(btrim(coalesce(product.rx_otc, ''))) = 'otc'
      AND EXISTS (SELECT 1 FROM catalog_variants v WHERE v.product_id = product.id AND v.active)
      THEN 0 ELSE 1 END`;
    const order = query.q && query.sort === "relevance" ? baseOrder : `${orderabilityOrder}, ${baseOrder}`;
    const filter = where.join(" AND ");
    // Every public page has the global sellability filter above, so the active
    // import total cannot be reused as the visible result count.
    let count: number | undefined;
    let facets: CatalogFacets | undefined;
    if (query.includeFacets) {
      const facetResult = await client.query<FacetAggregateRow>(
        buildFullCatalogFacetsSql(categoryCte, priceJoins, catalogPrice, availabilityPrice, filter),
        values,
      );
      const aggregate = localCatalogFacetsFromRow(facetResult.rows[0]);
      count = aggregate.count;
      facets = aggregate.facets;
    }
    const pageCountProjection = query.includeFacets || count != null
      ? ""
      : ", count(*) OVER()::integer AS filtered_count";
    const pageValues = [...values, query.limit, query.offset];
    const pageIds = await client.query<{ id: string; filtered_count: unknown; availability_confirmed: unknown }>(`
      ${categoryCte}
      SELECT product.id, ${catalogPrice} AS selected_price,
        (${availabilityPrice} IS NOT NULL) AS availability_confirmed${pageCountProjection}
      FROM catalog_products product
      ${priceJoins}
      WHERE ${filter}
      ORDER BY ${order}
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `, pageValues);
    if (count == null) count = integer(pageIds.rows[0]?.filtered_count) ?? undefined;
    // A valid load-more request normally has at least one row. Preserve a
    // correct count if data changed between pages or a caller supplied an
    // offset beyond the end, without paying for full facet aggregation.
    if (count == null) {
      const countResult = await client.query<{ filtered_count: unknown }>(`
        ${categoryCte}
        SELECT count(*)::integer AS filtered_count
        FROM catalog_products product
        ${priceJoins}
        WHERE ${filter}
      `, values);
      count = integer(countResult.rows[0]?.filtered_count) ?? 0;
    }
    if (!pageIds.rows.length) return { products: [], count, catalogTotal: expected, facets };
    const ids = pageIds.rows.map((row) => row.id);
    const result = await client.query<ProductRow>(`
      SELECT ${PRODUCT_COLUMNS}
      FROM catalog_product_read_model
      WHERE id = ANY($1::text[])
    `, [ids]);
    const byId = new Map(result.rows.map((row) => [row.id, mapRow(row)]));
    for (const row of pageIds.rows) {
      const product = byId.get(row.id);
      const selectedPrice = price((row as { selected_price?: unknown }).selected_price);
      const availabilityConfirmed = row.availability_confirmed === true;
      if (product) {
        product.price = selectedPrice ?? 0;
        product.priceTBD = selectedPrice === null;
        product.inStock = availabilityConfirmed;
        product.stockPharmacies = availabilityConfirmed ? Math.max(1, product.stockPharmacies) : 0;
        product.stockStale = !availabilityConfirmed;
      }
    }
    return {
      products: ids.map((id) => byId.get(id)).filter(Boolean) as Product[],
      count,
      catalogTotal: expected,
      facets,
    };
  });
}
