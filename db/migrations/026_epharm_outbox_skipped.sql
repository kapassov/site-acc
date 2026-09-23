-- Terminal state for historical ACC orders that are not eligible for cashier fulfillment.
ALTER TABLE integration_outbox DROP CONSTRAINT IF EXISTS integration_outbox_status_check;
ALTER TABLE integration_outbox ADD CONSTRAINT integration_outbox_status_check
  CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'skipped'));
