-- Native mobile push registrations. APNs device tokens are installation-
-- scoped delivery addresses, not user passwords. Access is restricted to the
-- application database role and every API operation is customer-authenticated.

CREATE TABLE IF NOT EXISTS native_push_devices (
    id                    uuid PRIMARY KEY,
    customer_id           text NOT NULL,
    installation_id       uuid NOT NULL,
    platform              text NOT NULL CHECK (platform IN ('ios')),
    token                 text NOT NULL,
    token_hash            char(64) NOT NULL UNIQUE,
    orders_enabled        boolean NOT NULL DEFAULT true,
    promos_enabled        boolean NOT NULL DEFAULT false,
    locale                varchar(20),
    city                  varchar(80),
    app_version           varchar(40),
    failure_count         integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    last_sent_at          timestamptz,
    last_success_at       timestamptz,
    last_error            varchar(300),
    revoked_at            timestamptz,
    revoke_reason         varchar(160),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS native_push_devices_customer_installation_uidx
    ON native_push_devices (customer_id, installation_id, platform);
CREATE INDEX IF NOT EXISTS native_push_devices_customer_active_idx
    ON native_push_devices (customer_id, updated_at DESC)
    WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS native_push_devices_promos_active_idx
    ON native_push_devices (updated_at DESC)
    WHERE revoked_at IS NULL AND promos_enabled;
CREATE INDEX IF NOT EXISTS native_push_devices_orders_active_idx
    ON native_push_devices (updated_at DESC)
    WHERE revoked_at IS NULL AND orders_enabled;
