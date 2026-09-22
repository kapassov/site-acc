-- Durable delivery of verified Kassa state to the Medusa order/payment modules.
-- No card details, provider secrets, raw notifications or customer PII.
CREATE TABLE IF NOT EXISTS medusa_payment_sync (
  event_id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES site_orders(id) ON DELETE RESTRICT,
  transaction_id text NOT NULL,
  payment_state text NOT NULL CHECK (payment_state IN ('paid','failed','refunded')),
  amount bigint NOT NULL CHECK (amount > 0),
  currency text NOT NULL CHECK (currency = 'KZT'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS medusa_payment_sync_pending_idx
  ON medusa_payment_sync(available_at) WHERE status = 'pending';
