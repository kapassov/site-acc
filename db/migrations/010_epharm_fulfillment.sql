-- Durable, immutable delivery body and monotonic return-status cursor.
ALTER TABLE integration_outbox ADD COLUMN IF NOT EXISTS epharm_request jsonb;
ALTER TABLE site_orders ADD COLUMN IF NOT EXISTS epharm_version integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS epharm_sync_state (
    id integer PRIMARY KEY CHECK(id=1),
    cursor bigint NOT NULL DEFAULT 0,
    last_success_at timestamptz
);
INSERT INTO epharm_sync_state(id) VALUES(1) ON CONFLICT DO NOTHING;
