-- A per-order callback is already serialized by kassa_payments FOR UPDATE.
-- Allocate sequence numbers at enqueue time, not from transaction-start now().
-- Legacy pending rows cannot be safely reordered from timestamps alone.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'medusa_payment_sync' AND column_name = 'event_sequence'
  ) AND EXISTS (SELECT 1 FROM medusa_payment_sync WHERE status = 'pending') THEN
    RAISE EXCEPTION 'medusa_payment_pending_events_require_reconciliation_before_sequence_migration';
  END IF;
END $$;

ALTER TABLE medusa_payment_sync ADD COLUMN IF NOT EXISTS event_sequence bigserial;
CREATE UNIQUE INDEX IF NOT EXISTS medusa_payment_sync_event_sequence_uq
  ON medusa_payment_sync(event_sequence);
CREATE INDEX IF NOT EXISTS medusa_payment_sync_order_pending_sequence_idx
  ON medusa_payment_sync(order_id,event_sequence) WHERE status = 'pending';
