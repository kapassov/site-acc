-- Preserve source prices to tiyn. Existing whole-tenge orders keep their value.
ALTER TABLE site_orders ALTER COLUMN total_amount TYPE numeric(18,2) USING total_amount::numeric(18,2);
ALTER TABLE kassa_payments ALTER COLUMN amount TYPE numeric(18,2) USING amount::numeric(18,2);
ALTER TABLE medusa_payment_sync ALTER COLUMN amount TYPE numeric(18,2) USING amount::numeric(18,2);
