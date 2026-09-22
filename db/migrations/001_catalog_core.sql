-- Canonical read model for the storefront.
-- Medusa remains the source during migration; this schema gives the Inkar
-- server a fast, recoverable local catalogue and stable integration boundary.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename     text PRIMARY KEY,
    sha256       text NOT NULL,
    applied_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog_import_runs (
    id                    uuid PRIMARY KEY,
    source                text NOT NULL,
    status                text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
    started_at            timestamptz NOT NULL DEFAULT now(),
    finished_at           timestamptz,
    expected_products     integer,
    processed_products    integer NOT NULL DEFAULT 0,
    processed_variants    integer NOT NULL DEFAULT 0,
    processed_images      integer NOT NULL DEFAULT 0,
    metrics               jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_message         text
);

CREATE TABLE IF NOT EXISTS catalog_categories (
    id                    text PRIMARY KEY,
    handle                text,
    name                  text NOT NULL,
    parent_id             text,
    rank                  integer NOT NULL DEFAULT 0,
    metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
    active                boolean NOT NULL DEFAULT true,
    source_updated_at     timestamptz,
    source_seen_at        timestamptz NOT NULL DEFAULT now(),
    source_run_id         uuid REFERENCES catalog_import_runs(id),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS catalog_categories_handle_uq
    ON catalog_categories (lower(handle)) WHERE handle IS NOT NULL AND handle <> '';
CREATE INDEX IF NOT EXISTS catalog_categories_parent_idx ON catalog_categories (parent_id);

CREATE TABLE IF NOT EXISTS catalog_products (
    id                    text PRIMARY KEY,
    handle                text NOT NULL,
    title                 text NOT NULL,
    subtitle              text,
    description           text,
    thumbnail_url         text,
    brand                 text,
    manufacturer          text,
    country               text,
    mnn                   text,
    atc                   text,
    rx_otc                text,
    metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
    active                boolean NOT NULL DEFAULT true,
    source_created_at     timestamptz,
    source_updated_at     timestamptz,
    source_seen_at        timestamptz NOT NULL DEFAULT now(),
    source_run_id         uuid REFERENCES catalog_import_runs(id),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    search_vector         tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('russian', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('russian', coalesce(brand, '')), 'B') ||
        setweight(to_tsvector('russian', coalesce(mnn, '')), 'B') ||
        setweight(to_tsvector('russian', coalesce(manufacturer, '')), 'C')
    ) STORED
);

CREATE UNIQUE INDEX IF NOT EXISTS catalog_products_handle_uq ON catalog_products (lower(handle));
CREATE INDEX IF NOT EXISTS catalog_products_active_idx ON catalog_products (active, updated_at DESC);
CREATE INDEX IF NOT EXISTS catalog_products_search_idx ON catalog_products USING gin (search_vector);
CREATE INDEX IF NOT EXISTS catalog_products_title_trgm_idx ON catalog_products USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS catalog_products_brand_idx ON catalog_products (lower(brand)) WHERE brand IS NOT NULL;
CREATE INDEX IF NOT EXISTS catalog_products_mnn_idx ON catalog_products (lower(mnn)) WHERE mnn IS NOT NULL;

CREATE TABLE IF NOT EXISTS catalog_variants (
    id                    text PRIMARY KEY,
    product_id            text NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
    title                 text NOT NULL,
    sku                   text,
    barcode               text,
    price_amount          bigint,
    original_price_amount bigint,
    currency_code         text,
    metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
    active                boolean NOT NULL DEFAULT true,
    source_seen_at        timestamptz NOT NULL DEFAULT now(),
    source_run_id         uuid REFERENCES catalog_import_runs(id),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_variants_product_idx ON catalog_variants (product_id, active);
CREATE INDEX IF NOT EXISTS catalog_variants_sku_idx ON catalog_variants (upper(sku)) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS catalog_variants_barcode_idx ON catalog_variants (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS catalog_variants_price_idx ON catalog_variants (price_amount) WHERE active AND price_amount IS NOT NULL;

CREATE TABLE IF NOT EXISTS catalog_product_categories (
    product_id            text NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
    category_id           text NOT NULL REFERENCES catalog_categories(id) ON DELETE CASCADE,
    is_primary            boolean NOT NULL DEFAULT false,
    PRIMARY KEY (product_id, category_id)
);

CREATE INDEX IF NOT EXISTS catalog_product_categories_category_idx
    ON catalog_product_categories (category_id, product_id);

CREATE TABLE IF NOT EXISTS catalog_images (
    id                    text PRIMARY KEY,
    product_id            text NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
    url                   text NOT NULL,
    position              integer NOT NULL DEFAULT 0,
    metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
    source_seen_at        timestamptz NOT NULL DEFAULT now(),
    source_run_id         uuid REFERENCES catalog_import_runs(id),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (product_id, url)
);

CREATE INDEX IF NOT EXISTS catalog_images_product_idx ON catalog_images (product_id, position);

-- Local pharmacy/offers boundary. ACC/Epharm can feed these tables without
-- changing the storefront product contract.
CREATE TABLE IF NOT EXISTS catalog_pharmacies (
    id                    text PRIMARY KEY,
    external_id           text,
    name                  text NOT NULL,
    city                  text,
    address               text,
    latitude              numeric(9, 6),
    longitude             numeric(9, 6),
    metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
    active                boolean NOT NULL DEFAULT true,
    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS catalog_pharmacies_external_uq
    ON catalog_pharmacies (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS catalog_pharmacies_city_idx ON catalog_pharmacies (lower(city)) WHERE city IS NOT NULL;

CREATE TABLE IF NOT EXISTS catalog_pharmacy_offers (
    product_id            text NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
    variant_id            text REFERENCES catalog_variants(id) ON DELETE CASCADE,
    pharmacy_id           text NOT NULL REFERENCES catalog_pharmacies(id) ON DELETE CASCADE,
    price_amount          bigint NOT NULL CHECK (price_amount >= 0),
    currency_code         text NOT NULL DEFAULT 'kzt',
    stock_quantity        numeric(14, 3),
    in_stock              boolean NOT NULL DEFAULT false,
    source_updated_at     timestamptz,
    updated_at            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (product_id, pharmacy_id)
);

CREATE INDEX IF NOT EXISTS catalog_pharmacy_offers_product_price_idx
    ON catalog_pharmacy_offers (product_id, in_stock, price_amount);
CREATE INDEX IF NOT EXISTS catalog_pharmacy_offers_pharmacy_idx
    ON catalog_pharmacy_offers (pharmacy_id, in_stock);

-- Transactional outbox for reliable ACC/Epharm/CDP delivery.
CREATE TABLE IF NOT EXISTS integration_outbox (
    id                    uuid PRIMARY KEY,
    topic                 text NOT NULL,
    aggregate_type        text NOT NULL,
    aggregate_id          text NOT NULL,
    payload               jsonb NOT NULL,
    idempotency_key       text NOT NULL UNIQUE,
    status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
    attempts              integer NOT NULL DEFAULT 0,
    available_at          timestamptz NOT NULL DEFAULT now(),
    locked_at             timestamptz,
    sent_at               timestamptz,
    last_error            text,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integration_outbox_dispatch_idx
    ON integration_outbox (status, available_at, created_at)
    WHERE status IN ('pending', 'failed');

CREATE OR REPLACE VIEW catalog_product_read_model AS
SELECT
    p.id,
    p.handle,
    p.title,
    p.subtitle,
    p.description,
    p.thumbnail_url,
    p.brand,
    p.manufacturer,
    p.country,
    p.mnn,
    p.atc,
    p.rx_otc,
    p.metadata,
    p.active,
    p.source_seen_at,
    p.updated_at,
    prices.min_price,
    prices.max_price,
    prices.currency_code,
    coalesce(categories.items, '[]'::jsonb) AS categories,
    coalesce(images.items, '[]'::jsonb) AS images,
    coalesce(variants.items, '[]'::jsonb) AS variants
FROM catalog_products p
LEFT JOIN LATERAL (
    SELECT min(v.price_amount) AS min_price,
           max(v.price_amount) AS max_price,
           min(v.currency_code) AS currency_code
    FROM catalog_variants v
    WHERE v.product_id = p.id AND v.active
) prices ON true
LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'handle', c.handle, 'name', c.name, 'is_primary', pc.is_primary
    ) ORDER BY pc.is_primary DESC, c.rank, c.name) AS items
    FROM catalog_product_categories pc
    JOIN catalog_categories c ON c.id = pc.category_id
    WHERE pc.product_id = p.id AND c.active
) categories ON true
LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'position', i.position)
                     ORDER BY i.position, i.id) AS items
    FROM catalog_images i
    WHERE i.product_id = p.id
) images ON true
LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
        'id', v.id, 'title', v.title, 'sku', v.sku, 'barcode', v.barcode,
        'price', v.price_amount, 'original_price', v.original_price_amount,
        'currency_code', v.currency_code
    ) ORDER BY v.id) AS items
    FROM catalog_variants v
    WHERE v.product_id = p.id AND v.active
) variants ON true;
