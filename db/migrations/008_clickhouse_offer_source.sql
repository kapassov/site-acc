-- Track the authoritative source snapshot used for each product offer set.
-- Existing Medusa checkpoints remain valid and receive explicit defaults.

ALTER TABLE catalog_offer_sync_state
    ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'medusa',
    ADD COLUMN IF NOT EXISTS source_snapshot_at timestamptz,
    ADD COLUMN IF NOT EXISTS mapping_source text;

ALTER TABLE catalog_offer_sync_state
    DROP CONSTRAINT IF EXISTS catalog_offer_sync_state_source_check;

ALTER TABLE catalog_offer_sync_state
    ADD CONSTRAINT catalog_offer_sync_state_source_check
    CHECK (source IN ('medusa', 'clickhouse'));

CREATE INDEX IF NOT EXISTS catalog_offer_sync_state_source_attempt_idx
    ON catalog_offer_sync_state (source, last_attempt_at, product_id);

-- Head-warehouse availability has no retail price, so keep it separate from
-- catalog_pharmacy_offers rather than inventing a zero-price pharmacy offer.
CREATE TABLE IF NOT EXISTS catalog_warehouse_stocks (
    product_id            text NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
    variant_id            text REFERENCES catalog_variants(id) ON DELETE SET NULL,
    warehouse_code        text NOT NULL,
    city                  text NOT NULL DEFAULT '',
    stock_quantity        numeric(14, 3) NOT NULL DEFAULT 0
                          CHECK (stock_quantity >= 0),
    in_transit_quantity   numeric(14, 3) NOT NULL DEFAULT 0
                          CHECK (in_transit_quantity >= 0),
    source_updated_at     timestamptz NOT NULL,
    updated_at            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (product_id, warehouse_code, city)
);

CREATE INDEX IF NOT EXISTS catalog_warehouse_stocks_available_idx
    ON catalog_warehouse_stocks (product_id, stock_quantity, in_transit_quantity)
    WHERE stock_quantity > 0 OR in_transit_quantity > 0;
