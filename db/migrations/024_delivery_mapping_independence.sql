-- A manually verified delivery mapping exists independently of the optional
-- Daribar stock-delta feed. Do not require a synthetic delta cursor merely to
-- calculate delivery or create an order.
ALTER TABLE daribar_pharmacy_mappings
    DROP CONSTRAINT IF EXISTS daribar_pharmacy_mappings_source_code_fkey;
