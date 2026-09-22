-- Standard N can supply fractional pack quantities beyond three decimal places.
-- Preserve exact source decimal; no rounding/upcasting of the historical column.
ALTER TABLE catalog_pharmacy_offers ADD COLUMN IF NOT EXISTS source_quantity numeric;
CREATE INDEX IF NOT EXISTS catalog_offers_source_quantity_snapshot_idx
  ON catalog_pharmacy_offers (source_snapshot_id, pharmacy_id, product_id, price_decimal)
  WHERE in_stock AND source_quantity >= 1 AND price_decimal > 0;
