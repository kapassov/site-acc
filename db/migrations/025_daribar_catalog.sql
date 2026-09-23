-- Versioned Daribar catalogue. A run is immutable after publication and the
-- storefront changes snapshots by updating exactly one state row in the same
-- transaction that completes the run. The previous run is retained for an
-- immediate feature/data rollback.

CREATE TABLE IF NOT EXISTS daribar_catalog_runs (
    id                uuid PRIMARY KEY,
    status            text NOT NULL CHECK (status IN ('staging', 'published', 'superseded', 'failed')),
    city              text NOT NULL,
    generated_at      timestamptz NOT NULL,
    source_count      integer NOT NULL CHECK (source_count > 0),
    normalized_count  integer NOT NULL DEFAULT 0 CHECK (normalized_count >= 0),
    checksum          text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
    metrics           jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    published_at      timestamptz,
    error_message     text
);

CREATE INDEX IF NOT EXISTS daribar_catalog_runs_created_idx
    ON daribar_catalog_runs (created_at DESC);

CREATE TABLE IF NOT EXISTS daribar_catalog_products (
    run_id            uuid NOT NULL REFERENCES daribar_catalog_runs(id) ON DELETE CASCADE,
    sku               text NOT NULL CHECK (sku ~ '^[A-Za-z0-9._:-]{1,96}$'),
    product_id        text NOT NULL,
    variant_id        text NOT NULL,
    slug              text NOT NULL,
    name              text NOT NULL,
    brand             text,
    category_slug     text NOT NULL,
    category_handles  text[] NOT NULL DEFAULT '{}',
    price_amount      bigint CHECK (price_amount IS NULL OR price_amount > 0),
    image_url         text,
    prescription      boolean NOT NULL DEFAULT false,
    catalog_stock     integer NOT NULL DEFAULT 0 CHECK (catalog_stock >= 0),
    product           jsonb NOT NULL,
    raw_payload       jsonb NOT NULL,
    PRIMARY KEY (run_id, sku),
    UNIQUE (run_id, product_id),
    UNIQUE (run_id, variant_id),
    UNIQUE (run_id, slug)
);

CREATE INDEX IF NOT EXISTS daribar_catalog_products_name_trgm_idx
    ON daribar_catalog_products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS daribar_catalog_products_category_idx
    ON daribar_catalog_products (run_id, category_slug, sku);
CREATE INDEX IF NOT EXISTS daribar_catalog_products_price_idx
    ON daribar_catalog_products (run_id, price_amount) WHERE price_amount IS NOT NULL;

CREATE TABLE IF NOT EXISTS daribar_catalog_state (
    singleton          boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    active_run_id      uuid REFERENCES daribar_catalog_runs(id),
    previous_run_id    uuid REFERENCES daribar_catalog_runs(id),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

INSERT INTO daribar_catalog_state (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS catalog_shadow_reports (
    id                  uuid PRIMARY KEY,
    daribar_run_id      uuid REFERENCES daribar_catalog_runs(id) ON DELETE SET NULL,
    medusa_run_id       uuid REFERENCES catalog_import_runs(id) ON DELETE SET NULL,
    generated_at        timestamptz NOT NULL DEFAULT now(),
    daribar_count       integer NOT NULL CHECK (daribar_count >= 0),
    medusa_count        integer NOT NULL CHECK (medusa_count >= 0),
    mapped_count        integer NOT NULL CHECK (mapped_count >= 0),
    price_match_count   integer NOT NULL CHECK (price_match_count >= 0),
    missing_in_daribar  integer NOT NULL CHECK (missing_in_daribar >= 0),
    missing_in_medusa   integer NOT NULL CHECK (missing_in_medusa >= 0),
    metrics             jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS catalog_shadow_reports_generated_idx
    ON catalog_shadow_reports (generated_at DESC);

