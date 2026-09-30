-- Daribar's category endpoint returns both UUID-native records and Standard-N
-- records with provider SKUs. Both groups belong to the provider catalogue.
-- Keep the generated UUID projection for exact joins without rejecting rows
-- that Daribar currently exposes only under a legacy provider SKU.

ALTER TABLE daribar_catalog_products
    DROP CONSTRAINT IF EXISTS daribar_catalog_products_uuid_required;

ALTER TABLE daribar_delivery_product_mappings
    DROP CONSTRAINT IF EXISTS daribar_delivery_product_mappings_uuid_required;
