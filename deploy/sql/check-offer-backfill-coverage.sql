\set ON_ERROR_STOP on

WITH active AS (
  SELECT product.id,
         state.last_attempt_at,
         state.last_success_at,
         state.status
  FROM catalog_products product
  LEFT JOIN catalog_offer_sync_state state ON state.product_id = product.id
  WHERE product.active
), products_with_offers AS (
  SELECT DISTINCT offer.product_id
  FROM catalog_pharmacy_offers offer
)
SELECT count(*) AS active_products,
       count(active.last_attempt_at) AS attempted_products,
       count(*) FILTER (WHERE active.last_attempt_at IS NULL) AS never_attempted,
       round(100.0 * count(active.last_attempt_at) / nullif(count(*), 0), 2) AS attempted_pct,
       count(active.last_success_at) AS successful_at_least_once,
       count(*) FILTER (WHERE active.status = 'success') AS current_success,
       count(*) FILTER (WHERE active.status = 'empty') AS current_empty,
       count(*) FILTER (WHERE active.status = 'failed') AS current_failed,
       count(products_with_offers.product_id) AS products_with_offers,
       min(active.last_attempt_at) AS oldest_attempt,
       max(active.last_attempt_at) AS newest_attempt
FROM active
LEFT JOIN products_with_offers ON products_with_offers.product_id = active.id;

SELECT status,
       coalesce(last_error, '') AS last_error,
       count(*) AS products
FROM catalog_offer_sync_state
GROUP BY status, coalesce(last_error, '')
ORDER BY products DESC, status, last_error
LIMIT 30;
