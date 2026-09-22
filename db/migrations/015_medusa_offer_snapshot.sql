-- A per-pharmacy offer may be served only with its matching complete Medusa snapshot.
-- NULL preserves historical rows without treating them as current inventory.
ALTER TABLE catalog_pharmacy_offers
  ADD COLUMN IF NOT EXISTS source_snapshot_id text;

CREATE INDEX IF NOT EXISTS catalog_pharmacy_offers_snapshot_pharmacy_idx
  ON catalog_pharmacy_offers (source_snapshot_id, pharmacy_id, product_id)
  WHERE in_stock AND stock_quantity > 0 AND price_amount > 0;
