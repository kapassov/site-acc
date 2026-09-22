-- Orders created by the storefront. Medusa remains the commerce system of
-- record; this table is the durable ACC/admin read model and the source for
-- reliable Epharm integration messages.

CREATE TABLE IF NOT EXISTS site_orders (
    id                    text PRIMARY KEY,
    source_system         text NOT NULL DEFAULT 'medusa'
                          CHECK (source_system IN ('medusa', 'storefront')),
    source_order_id       text NOT NULL UNIQUE,
    idempotency_key       text NOT NULL UNIQUE,
    display_number        integer NOT NULL CHECK (display_number >= 0),
    placed_at             timestamptz NOT NULL,
    total_amount          bigint NOT NULL CHECK (total_amount >= 0),
    currency_code         text NOT NULL DEFAULT 'kzt',
    status                text NOT NULL,
    status_version        integer NOT NULL DEFAULT 1 CHECK (status_version > 0),
    item_count            integer NOT NULL CHECK (item_count > 0),
    pickup_code           text,
    delivery_method       text NOT NULL,
    customer_id           text,
    is_demo               boolean NOT NULL DEFAULT false,
    metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_orders_placed_at_idx
    ON site_orders (placed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS site_orders_customer_idx
    ON site_orders (customer_id, placed_at DESC)
    WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_orders_customer_display_idx
    ON site_orders (customer_id, display_number)
    WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_orders_status_idx
    ON site_orders (status, placed_at DESC);

COMMENT ON COLUMN site_orders.idempotency_key IS
    'Stable application key; Medusa orders use medusa:<order_id>.';
COMMENT ON COLUMN site_orders.status_version IS
    'Monotonic revision used to make every Epharm status transition unique.';
