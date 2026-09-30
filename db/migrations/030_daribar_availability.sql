-- Atomically published Daribar price/stock index for storefront reads.
-- Daribar is queried only by the background synchronizer; web requests read
-- the active immutable run from PostgreSQL.

CREATE TABLE IF NOT EXISTS daribar_availability_runs (
    id                    uuid PRIMARY KEY,
    catalog_run_id        uuid NOT NULL REFERENCES daribar_catalog_runs(id) ON DELETE CASCADE,
    status                text NOT NULL CHECK (status IN ('staging', 'published', 'superseded', 'failed')),
    city                  text NOT NULL,
    expected_skus         integer NOT NULL CHECK (expected_skus > 0),
    processed_skus        integer NOT NULL DEFAULT 0 CHECK (processed_skus >= 0),
    offer_count           integer NOT NULL DEFAULT 0 CHECK (offer_count >= 0),
    started_at            timestamptz NOT NULL DEFAULT now(),
    finished_at           timestamptz,
    valid_until           timestamptz,
    metrics               jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_message         text
);

CREATE INDEX IF NOT EXISTS daribar_availability_runs_started_idx
    ON daribar_availability_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS daribar_product_availability (
    run_id                uuid NOT NULL REFERENCES daribar_availability_runs(id) ON DELETE CASCADE,
    sku                   text NOT NULL,
    in_stock              boolean NOT NULL,
    min_price             numeric(18, 2),
    pharmacy_count        integer NOT NULL DEFAULT 0 CHECK (pharmacy_count >= 0),
    total_quantity        numeric(18, 3) NOT NULL DEFAULT 0 CHECK (total_quantity >= 0),
    checked_at            timestamptz NOT NULL,
    PRIMARY KEY (run_id, sku),
    CHECK ((in_stock AND min_price > 0 AND pharmacy_count > 0 AND total_quantity > 0)
        OR (NOT in_stock AND min_price IS NULL AND pharmacy_count = 0 AND total_quantity = 0))
);

CREATE INDEX IF NOT EXISTS daribar_product_availability_visible_idx
    ON daribar_product_availability (run_id, min_price, sku) WHERE in_stock;

CREATE TABLE IF NOT EXISTS daribar_pharmacy_offers (
    run_id                uuid NOT NULL REFERENCES daribar_availability_runs(id) ON DELETE CASCADE,
    sku                   text NOT NULL,
    source_code           text NOT NULL,
    price_amount          numeric(18, 2) NOT NULL CHECK (price_amount > 0),
    stock_quantity        numeric(18, 3) NOT NULL CHECK (stock_quantity > 0),
    payment_on_site       boolean,
    payment_by_card       boolean,
    with_reserve          boolean,
    opening_hours         text,
    checked_at            timestamptz NOT NULL,
    PRIMARY KEY (run_id, sku, source_code)
);

-- Earlier emergency releases created the core table before payment and hours
-- fields were part of the checked-in schema. Keep this migration additive so
-- those production rows remain intact.
ALTER TABLE daribar_pharmacy_offers
    ADD COLUMN IF NOT EXISTS payment_on_site boolean,
    ADD COLUMN IF NOT EXISTS payment_by_card boolean,
    ADD COLUMN IF NOT EXISTS with_reserve boolean,
    ADD COLUMN IF NOT EXISTS opening_hours text;

CREATE INDEX IF NOT EXISTS daribar_pharmacy_offers_source_idx
    ON daribar_pharmacy_offers (run_id, source_code, sku);

CREATE TABLE IF NOT EXISTS daribar_availability_state (
    singleton             boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    active_run_id         uuid REFERENCES daribar_availability_runs(id),
    previous_run_id       uuid REFERENCES daribar_availability_runs(id),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

INSERT INTO daribar_availability_state (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;
