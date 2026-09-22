-- Kassa.com payment state is stored separately from order fulfilment state.
-- Card details are never accepted or persisted by the storefront.

CREATE TABLE IF NOT EXISTS kassa_payments (
    order_id               text PRIMARY KEY REFERENCES site_orders(id) ON DELETE RESTRICT,
    partner_payment_id     text NOT NULL UNIQUE,
    provider_payment_id    text UNIQUE,
    provider_token         text UNIQUE,
    amount                 bigint NOT NULL CHECK (amount > 0),
    currency_code          text NOT NULL,
    status                 text NOT NULL DEFAULT 'creating',
    payment_url            text,
    is_test                boolean NOT NULL DEFAULT false,
    status_description     text,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kassa_payments_status_idx
    ON kassa_payments (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS kassa_payment_notifications (
    body_sha256            text PRIMARY KEY,
    order_id               text NOT NULL REFERENCES site_orders(id) ON DELETE RESTRICT,
    notification_type      text NOT NULL,
    provider_status        text NOT NULL,
    received_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE kassa_payment_notifications IS
    'Idempotency receipts only; raw provider callbacks and card data are intentionally not stored.';
