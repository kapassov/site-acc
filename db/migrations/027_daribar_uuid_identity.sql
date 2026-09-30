-- Daribar UUID is the canonical product identity. Historical catalogue runs
-- keep their legacy SKUs for audit/rollback, while every new row must carry a
-- valid UUID and runtime reads can select it without parsing free-form text.

ALTER TABLE daribar_catalog_products
    ADD COLUMN IF NOT EXISTS daribar_uuid uuid
    GENERATED ALWAYS AS (
        CASE
            WHEN lower(sku) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                THEN lower(sku)::uuid
            ELSE NULL
        END
    ) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS daribar_catalog_products_run_uuid_idx
    ON daribar_catalog_products (run_id, daribar_uuid)
    WHERE daribar_uuid IS NOT NULL;

ALTER TABLE daribar_catalog_products
    DROP CONSTRAINT IF EXISTS daribar_catalog_products_uuid_required;
ALTER TABLE daribar_catalog_products
    ADD CONSTRAINT daribar_catalog_products_uuid_required
    CHECK (daribar_uuid IS NOT NULL) NOT VALID;

-- Delivery mappings are also commerce identities. Existing legacy mappings
-- remain visible for reconciliation, but cannot be inserted or updated until
-- their SKU has been converted to a Daribar UUID.
ALTER TABLE daribar_delivery_product_mappings
    DROP CONSTRAINT IF EXISTS daribar_delivery_product_mappings_uuid_required;
ALTER TABLE daribar_delivery_product_mappings
    ADD CONSTRAINT daribar_delivery_product_mappings_uuid_required
    CHECK (lower(sku) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') NOT VALID;
