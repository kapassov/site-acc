-- Preserve legacy integer-price views while introducing authoritative KZT/tiyn.
-- Deliberately no backfill: only a validated complete source snapshot may fill it.
ALTER TABLE catalog_pharmacy_offers ADD COLUMN IF NOT EXISTS price_decimal numeric(18,2);
CREATE INDEX IF NOT EXISTS catalog_offers_exact_snapshot_idx
  ON catalog_pharmacy_offers (source_snapshot_id, pharmacy_id, product_id, price_decimal)
  WHERE in_stock AND stock_quantity > 0 AND price_decimal > 0;
