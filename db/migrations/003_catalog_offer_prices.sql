-- Feed the existing storefront read model from per-pharmacy prices when
-- Medusa does not provide a calculated variant price. Existing columns keep
-- their order and meaning; stock_pharmacy_count is appended for future reads.

CREATE OR REPLACE VIEW catalog_product_read_model AS
SELECT
    p.id,
    p.handle,
    p.title,
    p.subtitle,
    p.description,
    p.thumbnail_url,
    p.brand,
    p.manufacturer,
    p.country,
    p.mnn,
    p.atc,
    p.rx_otc,
    p.metadata,
    p.active,
    p.source_seen_at,
    p.updated_at,
    coalesce(variant_prices.min_price, offer_prices.min_price) AS min_price,
    coalesce(variant_prices.max_price, offer_prices.max_price) AS max_price,
    coalesce(variant_prices.currency_code, offer_prices.currency_code) AS currency_code,
    coalesce(categories.items, '[]'::jsonb) AS categories,
    coalesce(images.items, '[]'::jsonb) AS images,
    coalesce(variants.items, '[]'::jsonb) AS variants,
    coalesce(offer_prices.stock_pharmacy_count, 0)::integer AS stock_pharmacy_count
FROM catalog_products p
LEFT JOIN LATERAL (
    SELECT min(v.price_amount) FILTER (WHERE v.price_amount > 0) AS min_price,
           max(v.price_amount) FILTER (WHERE v.price_amount > 0) AS max_price,
           min(v.currency_code) FILTER (WHERE v.price_amount > 0) AS currency_code
    FROM catalog_variants v
    WHERE v.product_id = p.id AND v.active
) variant_prices ON true
LEFT JOIN LATERAL (
    SELECT min(offer.price_amount) AS min_price,
           max(offer.price_amount) AS max_price,
           min(offer.currency_code) AS currency_code,
           count(*)::integer AS stock_pharmacy_count
    FROM catalog_pharmacy_offers offer
    JOIN catalog_pharmacies pharmacy
      ON pharmacy.id = offer.pharmacy_id AND pharmacy.active
    WHERE offer.product_id = p.id
      AND offer.in_stock
      AND offer.price_amount > 0
) offer_prices ON true
LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'handle', c.handle, 'name', c.name, 'is_primary', pc.is_primary
    ) ORDER BY pc.is_primary DESC, c.rank, c.name) AS items
    FROM catalog_product_categories pc
    JOIN catalog_categories c ON c.id = pc.category_id
    WHERE pc.product_id = p.id AND c.active
) categories ON true
LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'position', i.position)
                     ORDER BY i.position, i.id) AS items
    FROM catalog_images i
    WHERE i.product_id = p.id
) images ON true
LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
        'id', v.id, 'title', v.title, 'sku', v.sku, 'barcode', v.barcode,
        'price', v.price_amount, 'original_price', v.original_price_amount,
        'currency_code', v.currency_code
    ) ORDER BY v.id) AS items
    FROM catalog_variants v
    WHERE v.product_id = p.id AND v.active
) variants ON true;
