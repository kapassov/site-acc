-- Daribar can own the delivery/payment order while Medusa remains the catalogue authority.
ALTER TABLE site_orders DROP CONSTRAINT IF EXISTS site_orders_source_system_check;
ALTER TABLE site_orders ADD CONSTRAINT site_orders_source_system_check
    CHECK (source_system IN ('medusa', 'daribar', 'storefront'));
