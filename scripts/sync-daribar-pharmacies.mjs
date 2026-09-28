#!/usr/bin/env node
import { createHash } from "node:crypto";
import { getDaribarPharmacies } from "../src/lib/daribar/pharmacies.ts";
import { daribarDefaultCity } from "../src/lib/daribar/config.ts";
import { readDaribarCatalogSnapshot } from "../src/lib/daribar/snapshot-file.ts";
import { searchAllDaribarProductsV3 } from "../src/lib/daribar/product-search-v3.ts";
import { ordersDatabasePool } from "../src/lib/orders/store.ts";

function localId(sourceCode) {
  const digest = createHash("sha256").update(sourceCode, "utf8").digest("hex").slice(0, 24);
  return `sloc_Daribar${digest}`;
}

async function discoverySkus(pool) {
  try {
    const snapshot = await readDaribarCatalogSnapshot();
    const skus = snapshot.products
      .filter((product) => Number(product.quantity) > 0 || product.in_stock === true || product.in_stock === "1")
      .map((product) => String(product.sku || "").trim())
      .filter(Boolean)
      .slice(0, 5);
    if (skus.length) return skus;
  } catch {
    // A published PostgreSQL snapshot remains usable when a new file refresh
    // is temporarily blocked by the upstream catalogue endpoint.
  }
  const current = await pool.query(`
    SELECT product.sku
    FROM daribar_catalog_state state
    JOIN daribar_catalog_runs run ON run.id = state.active_run_id AND run.status = 'published'
    JOIN daribar_catalog_products product ON product.run_id = run.id
    WHERE state.singleton AND product.catalog_stock > 0
    ORDER BY product.catalog_stock DESC, product.sku
    LIMIT 5
  `);
  return current.rows.map((row) => String(row.sku || "").trim()).filter(Boolean);
}

async function discoverPharmacies(city, pool) {
  try {
    const directory = await getDaribarPharmacies(city);
    if (directory.length) return directory;
  } catch {
    // Some partner credentials allow catalogue/commerce v3 but not the legacy
    // pharmacy directory. The v3 response still carries the same exact source
    // identity and coordinates under the integration code.
  }
  const skus = await discoverySkus(pool);
  if (!skus.length) throw new Error("daribar_pharmacy_discovery_sku_missing");
  const rows = await searchAllDaribarProductsV3({
    city,
    items: skus.map((sku) => ({ sku, countDesired: 1 })),
    availability: "all",
    replacements: false,
    enableOnSite: true,
  });
  return [...new Map(rows
    .filter((row) => row.city.toLocaleLowerCase("ru") === city.toLocaleLowerCase("ru")
      && row.address && row.lat !== undefined && row.lon !== undefined)
    .map((row) => [row.sourceCode, {
      sourceCode: row.sourceCode,
      name: row.name,
      address: row.address,
      city: row.city,
      lat: row.lat,
      lon: row.lon,
      hours: row.openingHours || "График уточняется",
    }])).values()];
}

const pool = await ordersDatabasePool();
try {
  const city = daribarDefaultCity();
  const pharmacies = await discoverPharmacies(city, pool);
  if (!pharmacies.length) throw new Error("daribar_pharmacy_directory_empty");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let created = 0;
    let updated = 0;
    for (const pharmacy of pharmacies) {
      const existing = await client.query(`
        SELECT mapping.pharmacy_id
        FROM daribar_pharmacy_mappings mapping
        WHERE mapping.source_code = $1
        UNION ALL
        SELECT pharmacy.id AS pharmacy_id
        FROM catalog_pharmacies pharmacy
        WHERE pharmacy.external_id = $1
        LIMIT 1
      `, [pharmacy.sourceCode]);
      const pharmacyId = existing.rows[0]?.pharmacy_id || localId(pharmacy.sourceCode);
      await client.query(`
        INSERT INTO catalog_pharmacies
          (id, external_id, name, city, address, latitude, longitude, metadata, active, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, jsonb_build_object('hours', $8::text, 'source', 'daribar'), true, now())
        ON CONFLICT (id) DO UPDATE SET
          external_id = coalesce(catalog_pharmacies.external_id, EXCLUDED.external_id),
          name = EXCLUDED.name,
          city = EXCLUDED.city,
          address = EXCLUDED.address,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          metadata = catalog_pharmacies.metadata || EXCLUDED.metadata,
          active = true,
          updated_at = now()
      `, [pharmacyId, pharmacy.sourceCode, pharmacy.name, pharmacy.city, pharmacy.address,
        pharmacy.lat, pharmacy.lon, pharmacy.hours]);
      await client.query(`
        INSERT INTO daribar_pharmacy_mappings
          (source_code, pharmacy_id, mapping_source, enabled, created_at, updated_at)
        VALUES ($1, $2, 'auto_exact', true, now(), now())
        ON CONFLICT (source_code) DO UPDATE SET
          pharmacy_id = EXCLUDED.pharmacy_id,
          enabled = true,
          updated_at = now()
      `, [pharmacy.sourceCode, pharmacyId]);
      if (existing.rowCount) updated += 1;
      else created += 1;
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ status: "ok", discovered: pharmacies.length, created, updated }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
