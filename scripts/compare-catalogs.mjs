#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg;
const connectionString = String(process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();
if (!connectionString) throw new Error("catalog_shadow_database_not_configured");
const parsed = new URL(connectionString);
const client = new Client({ connectionString, application_name: "catalog-shadow-compare",
  ssl: parsed.searchParams.get("sslmode") === "require" ? { rejectUnauthorized: true } : undefined });

try {
  await client.connect();
  const result = await client.query(`
    WITH active_daribar AS (
      SELECT run.id AS run_id, run.normalized_count, product.sku, product.price_amount
      FROM daribar_catalog_state state
      JOIN daribar_catalog_runs run ON run.id = state.active_run_id AND run.status = 'published'
      JOIN daribar_catalog_products product ON product.run_id = run.id
      WHERE state.singleton
    ), active_medusa AS (
      SELECT run.id AS run_id, run.processed_products
      FROM catalog_import_runs run
      WHERE run.status = 'completed' AND run.expected_products = run.processed_products
      ORDER BY run.started_at DESC LIMIT 1
    ), mapped AS (
      SELECT DISTINCT mapping.product_id, mapping.sku
      FROM daribar_delivery_product_mappings mapping
      JOIN catalog_products product ON product.id = mapping.product_id AND product.active
      WHERE mapping.enabled
    ), comparison AS (
      SELECT mapped.product_id, mapped.sku, daribar.price_amount AS daribar_price,
             CASE WHEN product.metadata->>'standard_n_min_price' ~ '^\\d+(\\.\\d{1,2})?$'
               THEN (product.metadata->>'standard_n_min_price')::numeric ELSE NULL END AS medusa_price
      FROM mapped
      JOIN catalog_products product ON product.id = mapped.product_id
      LEFT JOIN active_daribar daribar ON daribar.sku = mapped.sku
    )
    SELECT
      (SELECT run_id FROM active_daribar LIMIT 1) AS daribar_run_id,
      (SELECT run_id FROM active_medusa LIMIT 1) AS medusa_run_id,
      (SELECT normalized_count FROM active_daribar LIMIT 1)::integer AS daribar_count,
      (SELECT processed_products FROM active_medusa LIMIT 1)::integer AS medusa_count,
      count(*) FILTER (WHERE daribar_price IS NOT NULL)::integer AS mapped_count,
      count(*) FILTER (WHERE daribar_price = medusa_price)::integer AS price_match_count,
      count(*) FILTER (WHERE daribar_price IS NULL)::integer AS missing_in_daribar,
      greatest(0, (SELECT normalized_count FROM active_daribar LIMIT 1)
        - count(*) FILTER (WHERE daribar_price IS NOT NULL))::integer AS missing_in_medusa,
      coalesce(avg(abs(daribar_price - medusa_price)) FILTER (
        WHERE daribar_price IS NOT NULL AND medusa_price IS NOT NULL
      ), 0)::numeric(14,2) AS average_price_delta
    FROM comparison
  `);
  const row = result.rows[0];
  if (!row?.daribar_run_id || !row?.medusa_run_id) throw new Error("catalog_shadow_snapshot_unavailable");
  const id = randomUUID();
  await client.query(`
    INSERT INTO catalog_shadow_reports (
      id, daribar_run_id, medusa_run_id, daribar_count, medusa_count,
      mapped_count, price_match_count, missing_in_daribar, missing_in_medusa, metrics
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
  `, [id, row.daribar_run_id, row.medusa_run_id, row.daribar_count, row.medusa_count,
    row.mapped_count, row.price_match_count, row.missing_in_daribar, row.missing_in_medusa,
    JSON.stringify({ average_price_delta: Number(row.average_price_delta) })]);
  process.stdout.write(`${JSON.stringify({ ok: true, id, ...row })}\n`);
} finally {
  await client.end().catch(() => undefined);
}
