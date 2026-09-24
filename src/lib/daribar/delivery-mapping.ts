import { ordersDatabasePool } from "../orders/store.ts";
import type { StandardNLine } from "../standardn-commerce.ts";
import { detectCheckoutItemsSource, type CanonicalCheckoutItem } from "../checkoutItems.ts";
import { medusaKnownPriceSql } from "../medusa-stock.ts";
import { exactKzt } from "../money.ts";
import { withRegistryCoordinates } from "../pharmacy-coordinate-registry.ts";
import { DaribarDeliveryError, type DaribarDeliveryItem } from "./delivery.ts";
import { daribarSkuFromIds } from "./ids.ts";

type ProductMappingRow = {
  ware_id: string;
  product_id: string;
  variant_id: string;
  sku: string;
  unit_price?: string | number | null;
};
type PharmacyMappingRow = { id: string; name: string; city: string | null; address: string | null; source_code: string;
  latitude?: string | number | null; longitude?: string | number | null; hours?: string | null };
export type DeliveryMappedPharmacy = { id: string; sourceCode: string; name: string; city: string; address: string;
  lat?: number; lon?: number; hours?: string };
export type DeliveryMappedItem = CanonicalCheckoutItem & { wareId: string; sku: string; unitPrice: number };

async function mapNativeDaribarItems(items: CanonicalCheckoutItem[]): Promise<DeliveryMappedItem[]> {
  const decoded = items.map((item) => ({ ...item, sku: daribarSkuFromIds(item.productId, item.variantId) }));
  if (decoded.some((item) => !item.sku)) throw new DaribarDeliveryError(400, "invalid_delivery_items");
  const db = await ordersDatabasePool();
  const result = await db.query<{ sku: string; price_amount: string | number | null }>(`
    SELECT product.sku, product.price_amount
    FROM daribar_catalog_state state
    JOIN daribar_catalog_runs run ON run.id = state.active_run_id AND run.status = 'published'
    JOIN daribar_catalog_products product ON product.run_id = run.id
    WHERE state.singleton AND product.sku = ANY($1::text[])
  `, [decoded.map((item) => item.sku)]);
  const prices = new Map(result.rows.map((row) => [row.sku, exactKzt(row.price_amount)]));
  return decoded.map((item) => {
    const sku = item.sku!;
    const unitPrice = prices.get(sku) || 0;
    if (unitPrice <= 0) throw new DaribarDeliveryError(409, "cart_item_unavailable");
    return { productId: item.productId, variantId: item.variantId, quantity: item.quantity,
      sku, wareId: sku, unitPrice };
  });
}

/** Resolves a complete basket. Native Daribar items never use a Medusa mapping. */
export async function mapCheckoutItemsToDaribar(items: CanonicalCheckoutItem[]): Promise<DeliveryMappedItem[]> {
  if (!Array.isArray(items) || items.length < 1 || items.length > 30) {
    throw new DaribarDeliveryError(400, "invalid_delivery_items");
  }
  const source = detectCheckoutItemsSource(items);
  if (source === "daribar") return mapNativeDaribarItems(items);
  if (source !== "medusa") throw new DaribarDeliveryError(400, "invalid_delivery_items");
  const db = await ordersDatabasePool();
  const result = await db.query<ProductMappingRow>(`
    WITH requested AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb)
        AS item(product_id text, variant_id text)
    )
    SELECT mapping.ware_id, mapping.product_id, mapping.variant_id, mapping.sku,
           ${medusaKnownPriceSql("product")} AS unit_price
    FROM requested
    JOIN daribar_delivery_product_mappings mapping
      ON mapping.product_id = requested.product_id
     AND mapping.variant_id = requested.variant_id
     AND mapping.enabled
    JOIN catalog_products product
      ON product.id = requested.product_id
     AND product.active
    ORDER BY mapping.product_id, mapping.variant_id, mapping.sku
  `, [JSON.stringify(items.map(({ productId, variantId }) => ({ product_id: productId, variant_id: variantId })))]);
  const rows = new Map<string, ProductMappingRow[]>();
  for (const row of result.rows) {
    const key = `${row.product_id}\u0000${row.variant_id}`;
    rows.set(key, [...(rows.get(key) || []), row]);
  }
  const seenSku = new Set<string>();
  return items.map((item) => {
    const candidates = rows.get(`${item.productId}\u0000${item.variantId}`) || [];
    const row = candidates.length === 1 ? candidates[0] : undefined;
    const sku = row?.sku?.trim() || "";
    const wareId = row?.ware_id?.trim().toLowerCase() || "";
    const unitPrice = exactKzt(row?.unit_price);
    if (!row || !/^[A-Za-z0-9._-]{1,160}$/.test(sku)
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(wareId)
        || unitPrice <= 0) {
      throw new DaribarDeliveryError(409, "delivery_product_mapping_missing");
    }
    if (seenSku.has(sku)) throw new DaribarDeliveryError(409, "delivery_product_mapping_ambiguous");
    seenSku.add(sku);
    return { ...item, wareId, sku, unitPrice };
  });
}

export async function daribarSkuForMedusaProduct(productId: string): Promise<string | null> {
  if (!/^prod_[A-Za-z0-9]+$/.test(productId)) return null;
  const db = await ordersDatabasePool();
  const result = await db.query<{ sku: string }>(`
    SELECT DISTINCT sku
    FROM daribar_delivery_product_mappings
    WHERE enabled AND product_id = $1
    ORDER BY sku LIMIT 2
  `, [productId]);
  if (result.rows.length !== 1) return null;
  const sku = result.rows[0].sku?.trim() || "";
  return /^[A-Za-z0-9._-]{1,160}$/.test(sku) ? sku : null;
}

export async function mappedDaribarPharmacies(city?: string): Promise<Map<string, DeliveryMappedPharmacy>> {
  const db = await ordersDatabasePool();
  const normalizedCity = String(city || "").normalize("NFKC").trim();
  const result = await db.query<PharmacyMappingRow>(`
    SELECT pharmacy.id, pharmacy.name, pharmacy.city, pharmacy.address, pharmacy.latitude, pharmacy.longitude,
           pharmacy.metadata->>'hours' AS hours, mapping.source_code
    FROM daribar_pharmacy_mappings mapping
    JOIN catalog_pharmacies pharmacy ON pharmacy.id = mapping.pharmacy_id AND pharmacy.active
    WHERE mapping.enabled
      AND ($1::text = '' OR lower(coalesce(pharmacy.city, '')) = lower($1))
    ORDER BY mapping.source_code
  `, [normalizedCity]);
  return new Map(result.rows.map(publicPharmacy)
    .filter((value): value is DeliveryMappedPharmacy => Boolean(value))
    .map((value) => [value.sourceCode, value]));
}

export async function mapQuoteLinesToDaribar(lines: StandardNLine[]): Promise<DaribarDeliveryItem[]> {
  if (detectCheckoutItemsSource(lines) === "daribar") {
    return lines.map((line) => {
      const sku = daribarSkuFromIds(line.productId, line.variantId);
      if (!sku) throw new DaribarDeliveryError(409, "delivery_product_mapping_missing");
      return { sku, countDesired: line.quantity };
    });
  }
  const db = await ordersDatabasePool();
  const result = await db.query<ProductMappingRow>(`
    SELECT mapping.ware_id, mapping.product_id, mapping.variant_id, mapping.sku
    FROM daribar_delivery_product_mappings mapping
    WHERE mapping.enabled AND lower(mapping.ware_id) = ANY($1::text[])
  `, [lines.map(line => line.wareId.toLowerCase())]);
  const mapped = new Map(result.rows.map(row => [row.ware_id.toLowerCase(), row]));
  const seen = new Set<string>();
  return lines.map(line => {
    const row = mapped.get(line.wareId.toLowerCase());
    const sku = row?.sku?.trim() || "";
    if (!row || row.product_id !== line.productId || row.variant_id !== line.variantId || !/^[A-Za-z0-9._-]{1,160}$/.test(sku)) {
      throw new DaribarDeliveryError(409, "delivery_product_mapping_missing");
    }
    if (seen.has(sku)) throw new DaribarDeliveryError(409, "delivery_product_mapping_ambiguous");
    seen.add(sku);
    return { sku, countDesired: line.quantity };
  });
}

function publicPharmacy(row: PharmacyMappingRow | undefined): DeliveryMappedPharmacy | null {
  if (!row || !/^sloc_[A-Za-z0-9]+$/.test(row.id) || !/^[A-Za-z0-9_-]{1,128}$/.test(row.source_code)) return null;
  const city = row.city?.trim() || (/боролдай/iu.test(`${row.name} ${row.address || ""}`) ? "Алматы" : "");
  if (!city) return null;
  const lat = row.latitude == null ? undefined : Number(row.latitude);
  const lon = row.longitude == null ? undefined : Number(row.longitude);
  return withRegistryCoordinates({ id: row.id, sourceCode: row.source_code, name: row.name, city,
    address: row.address || row.name,
    ...(lat !== undefined && Number.isFinite(lat) && Math.abs(lat) <= 90 ? { lat } : {}),
    ...(lon !== undefined && Number.isFinite(lon) && Math.abs(lon) <= 180 ? { lon } : {}),
    hours: row.hours?.trim() || "" });
}
export async function mapLocalPharmacyToDaribar(pharmacyId: string): Promise<DeliveryMappedPharmacy> {
  const db = await ordersDatabasePool();
  const result = await db.query<PharmacyMappingRow>(`
    SELECT pharmacy.id, pharmacy.name, pharmacy.city, pharmacy.address, pharmacy.latitude, pharmacy.longitude,
           pharmacy.metadata->>'hours' AS hours, mapping.source_code
    FROM daribar_pharmacy_mappings mapping
    JOIN catalog_pharmacies pharmacy ON pharmacy.id = mapping.pharmacy_id AND pharmacy.active
    WHERE mapping.enabled AND pharmacy.id = $1 LIMIT 2
  `, [pharmacyId]);
  const pharmacy = result.rows.length === 1 ? publicPharmacy(result.rows[0]) : null;
  if (!pharmacy) throw new DaribarDeliveryError(409, "delivery_pharmacy_mapping_missing");
  return pharmacy;
}
export async function mapDaribarPharmacyToLocal(sourceCode: string): Promise<DeliveryMappedPharmacy> {
  const db = await ordersDatabasePool();
  const result = await db.query<PharmacyMappingRow>(`
    SELECT pharmacy.id, pharmacy.name, pharmacy.city, pharmacy.address, pharmacy.latitude, pharmacy.longitude,
           pharmacy.metadata->>'hours' AS hours, mapping.source_code
    FROM daribar_pharmacy_mappings mapping
    JOIN catalog_pharmacies pharmacy ON pharmacy.id = mapping.pharmacy_id AND pharmacy.active
    WHERE mapping.enabled AND mapping.source_code = $1 LIMIT 2
  `, [sourceCode]);
  const pharmacy = result.rows.length === 1 ? publicPharmacy(result.rows[0]) : null;
  if (!pharmacy) throw new DaribarDeliveryError(409, "delivery_pharmacy_mapping_missing");
  return pharmacy;
}

export async function mappedDaribarPharmacyIds(): Promise<Set<string>> {
  const db = await ordersDatabasePool();
  const result = await db.query<{ pharmacy_id: string }>(`
    SELECT pharmacy_id FROM daribar_pharmacy_mappings WHERE enabled
  `);
  return new Set(result.rows.map(row => row.pharmacy_id));
}

/** Ranks only mapped pharmacies that can fulfil every Medusa cart line. */
export async function rankMappedPharmaciesForItems(
  items: CanonicalCheckoutItem[], city: string,
): Promise<DeliveryMappedPharmacy[]> {
  const db = await ordersDatabasePool();
  const payload = JSON.stringify(items.map(item => ({
    product_id: item.productId, variant_id: item.variantId, quantity: item.quantity,
  })));
  const result = await db.query<PharmacyMappingRow>(`
    WITH requested AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb)
        AS item(product_id text, variant_id text, quantity integer)
    ), candidates AS (
      SELECT mapping.source_code, pharmacy.id, pharmacy.name, pharmacy.city, pharmacy.address,
             pharmacy.latitude, pharmacy.longitude, pharmacy.metadata->>'hours' AS hours,
             sum(offer.price_decimal * requested.quantity) AS goods_total,
             count(*) AS matched
      FROM requested
      JOIN daribar_delivery_product_mappings product_mapping
        ON product_mapping.product_id = requested.product_id
       AND product_mapping.variant_id = requested.variant_id AND product_mapping.enabled
      JOIN catalog_pharmacy_offers offer
        ON offer.product_id = requested.product_id AND offer.variant_id = requested.variant_id
       AND offer.in_stock AND offer.source_quantity >= requested.quantity AND offer.price_decimal > 0
      JOIN daribar_pharmacy_mappings mapping ON mapping.pharmacy_id = offer.pharmacy_id AND mapping.enabled
      JOIN catalog_pharmacies pharmacy ON pharmacy.id = mapping.pharmacy_id AND pharmacy.active
      WHERE lower(coalesce(pharmacy.city, $2)) = lower($2)
      GROUP BY mapping.source_code, pharmacy.id, pharmacy.name, pharmacy.city, pharmacy.address,
               pharmacy.latitude, pharmacy.longitude, pharmacy.metadata->>'hours'
      HAVING count(*) = (SELECT count(*) FROM requested)
      ORDER BY goods_total, pharmacy.id
      LIMIT 5
    )
    SELECT id, name, city, address, latitude, longitude, hours, source_code FROM candidates
  `, [payload, city]);
  return result.rows.map(publicPharmacy).filter((value): value is DeliveryMappedPharmacy => Boolean(value));
}
