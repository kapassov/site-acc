-- Cover the hot paths used by the full-catalog facet query.
--
-- Category traversal already has both required directions:
--   catalog_product_categories_pkey (product_id, category_id)
--   catalog_product_categories_category_idx (category_id, product_id)
-- and catalog_categories_parent_idx covers recursive descendants. Keep those
-- indexes rather than duplicating them here.

-- Supports min(price_amount) GROUP BY product_id with an index-only scan and
-- the correlated sale lookup used by catalogue filters/facets.
CREATE INDEX IF NOT EXISTS catalog_variants_active_product_price_idx
    ON catalog_variants (product_id, price_amount)
    WHERE active AND price_amount > 0;

-- The sale subset is normally much smaller than all active variants. This
-- turns EXISTS(on sale) into a product-id probe instead of visiting every
-- active variant of a product.
CREATE INDEX IF NOT EXISTS catalog_variants_active_sale_product_idx
    ON catalog_variants (product_id)
    WHERE active
      AND price_amount > 0
      AND original_price_amount > price_amount;

-- Pharmacy offers can be much larger than the product catalogue. The partial
-- covering index excludes unavailable/zero-price rows and supplies everything
-- required by the in-stock min-price aggregation and active-pharmacy join.
CREATE INDEX IF NOT EXISTS catalog_pharmacy_offers_in_stock_product_price_idx
    ON catalog_pharmacy_offers (product_id, price_amount, pharmacy_id)
    WHERE in_stock AND price_amount > 0;

-- Existing catalog_products_brand_idx is on lower(brand), while the API first
-- resolves slugs and then filters by the canonical exact brand value. This
-- index matches that predicate and keeps product ids available to the join.
CREATE INDEX IF NOT EXISTS catalog_products_active_brand_exact_idx
    ON catalog_products (brand, id)
    WHERE active AND brand IS NOT NULL;
