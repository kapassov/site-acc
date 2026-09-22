-- CDP MVP: consent-aware identity resolution and an append-only event stream.
-- Raw phone numbers are deliberately not stored here; identities must be
-- normalized and HMAC-hashed by the application before insertion.

CREATE TABLE IF NOT EXISTS cdp_profiles (
    id                    uuid PRIMARY KEY,
    customer_id           text UNIQUE,
    status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'merged', 'deleted')),
    merged_into_id        uuid REFERENCES cdp_profiles(id),
    traits                jsonb NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at         timestamptz NOT NULL,
    last_seen_at          timestamptz NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CHECK (merged_into_id IS NULL OR merged_into_id <> id)
);

CREATE INDEX IF NOT EXISTS cdp_profiles_last_seen_idx ON cdp_profiles (last_seen_at DESC);

CREATE TABLE IF NOT EXISTS cdp_identities (
    id                    uuid PRIMARY KEY,
    profile_id            uuid NOT NULL REFERENCES cdp_profiles(id) ON DELETE CASCADE,
    identity_type         text NOT NULL
                          CHECK (identity_type IN ('customer_id', 'anonymous_id', 'device_id', 'phone_hmac')),
    identity_hash         text NOT NULL,
    verified              boolean NOT NULL DEFAULT false,
    first_seen_at         timestamptz NOT NULL,
    last_seen_at          timestamptz NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (identity_type, identity_hash)
);

CREATE INDEX IF NOT EXISTS cdp_identities_profile_idx ON cdp_identities (profile_id);

CREATE TABLE IF NOT EXISTS cdp_consents (
    id                    uuid PRIMARY KEY,
    profile_id            uuid NOT NULL REFERENCES cdp_profiles(id) ON DELETE CASCADE,
    purpose               text NOT NULL
                          CHECK (purpose IN ('essential', 'analytics', 'personalization', 'marketing', 'push')),
    state                 text NOT NULL CHECK (state IN ('granted', 'denied', 'withdrawn')),
    policy_version        text NOT NULL,
    source                text NOT NULL,
    occurred_at           timestamptz NOT NULL,
    proof                 jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cdp_consents_profile_purpose_idx
    ON cdp_consents (profile_id, purpose, occurred_at DESC);

CREATE TABLE IF NOT EXISTS cdp_events (
    id                    uuid PRIMARY KEY,
    idempotency_key       text NOT NULL UNIQUE,
    event_name            text NOT NULL,
    event_version         integer NOT NULL DEFAULT 1 CHECK (event_version > 0),
    profile_id            uuid REFERENCES cdp_profiles(id),
    customer_id           text,
    anonymous_id_hash     text,
    session_id_hash       text,
    source                text NOT NULL CHECK (source IN ('web', 'android', 'ios', 'backend', 'admin', 'epharm')),
    occurred_at           timestamptz NOT NULL,
    received_at           timestamptz NOT NULL DEFAULT now(),
    properties            jsonb NOT NULL DEFAULT '{}'::jsonb,
    context               jsonb NOT NULL DEFAULT '{}'::jsonb,
    consent_snapshot      jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS cdp_events_name_time_idx ON cdp_events (event_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS cdp_events_profile_time_idx
    ON cdp_events (profile_id, occurred_at DESC) WHERE profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cdp_events_customer_time_idx
    ON cdp_events (customer_id, occurred_at DESC) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cdp_events_anonymous_time_idx
    ON cdp_events (anonymous_id_hash, occurred_at DESC) WHERE anonymous_id_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS cdp_dead_letters (
    id                    uuid PRIMARY KEY,
    idempotency_key       text,
    source                text NOT NULL,
    payload               jsonb NOT NULL,
    error_code            text NOT NULL,
    error_message         text,
    received_at           timestamptz NOT NULL DEFAULT now(),
    resolved_at           timestamptz
);

CREATE INDEX IF NOT EXISTS cdp_dead_letters_open_idx
    ON cdp_dead_letters (received_at) WHERE resolved_at IS NULL;
