-- Durable Web Push state for production. Raw device tokens are never stored:
-- the application persists only their SHA-256 digests.

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id                    uuid PRIMARY KEY,
    device_id             uuid NOT NULL UNIQUE,
    customer_id           text,
    device_token_hash     char(64) NOT NULL,
    endpoint              text NOT NULL,
    expiration_time       bigint,
    p256dh                text NOT NULL,
    auth                  text NOT NULL,
    orders_enabled        boolean NOT NULL DEFAULT true,
    promos_enabled        boolean NOT NULL DEFAULT false,
    locale                varchar(20),
    city                  varchar(80),
    user_agent            varchar(300),
    failure_count         integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    last_sent_at          timestamptz,
    last_success_at       timestamptz,
    last_error            varchar(300),
    revoked_at            timestamptz,
    revoke_reason         varchar(160),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CHECK (expiration_time IS NULL OR expiration_time >= 0)
);

-- A browser endpoint may be reassigned, while the revoked row remains as an
-- audit record. Only one active subscription can own an endpoint at a time.
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_active_endpoint_uidx
    ON push_subscriptions (endpoint) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS push_subscriptions_customer_active_idx
    ON push_subscriptions (customer_id, updated_at DESC)
    WHERE revoked_at IS NULL AND customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS push_subscriptions_promos_active_idx
    ON push_subscriptions (updated_at DESC)
    WHERE revoked_at IS NULL AND customer_id IS NOT NULL AND promos_enabled;
CREATE INDEX IF NOT EXISTS push_subscriptions_orders_active_idx
    ON push_subscriptions (updated_at DESC)
    WHERE revoked_at IS NULL AND customer_id IS NOT NULL AND orders_enabled;

CREATE TABLE IF NOT EXISTS push_order_bindings (
    order_number          text NOT NULL,
    device_id             uuid NOT NULL REFERENCES push_subscriptions(device_id) ON DELETE CASCADE,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (order_number, device_id)
);

CREATE INDEX IF NOT EXISTS push_order_bindings_device_idx
    ON push_order_bindings (device_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS push_order_bindings_updated_idx
    ON push_order_bindings (updated_at DESC);

CREATE TABLE IF NOT EXISTS push_notification_history (
    id                    uuid PRIMARY KEY,
    kind                  text NOT NULL CHECK (kind IN ('campaign', 'event', 'order-status')),
    event_name            text,
    audience              text CHECK (audience IS NULL OR audience IN ('all', 'promos', 'orders')),
    order_number          text,
    order_status          text,
    payload               jsonb NOT NULL,
    delivery              jsonb NOT NULL,
    created_at            timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS push_notification_history_created_idx
    ON push_notification_history (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS push_notification_history_order_idx
    ON push_notification_history (order_number, created_at DESC)
    WHERE order_number IS NOT NULL;
