-- Checkpoints for the resumable per-pharmacy offer synchronizer. This table
-- is deliberately separate from catalog_import_runs: an incremental offer run
-- must never become the latest full catalogue snapshot used by the read model.

CREATE TABLE IF NOT EXISTS catalog_offer_sync_state (
    product_id            text PRIMARY KEY REFERENCES catalog_products(id) ON DELETE CASCADE,
    last_attempt_at       timestamptz NOT NULL,
    last_success_at       timestamptz,
    status                text NOT NULL CHECK (status IN ('success', 'empty', 'failed')),
    consecutive_failures  integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    last_offer_count      integer CHECK (last_offer_count IS NULL OR last_offer_count >= 0),
    last_error            text,
    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_offer_sync_state_attempt_idx
    ON catalog_offer_sync_state (last_attempt_at, product_id);
