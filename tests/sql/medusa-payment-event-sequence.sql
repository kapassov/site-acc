-- Read-only with respect to application data: temporary tables, then ROLLBACK.
-- Models callbacks whose transactions began out of order, while paid acquired
-- the payment lock and was accepted before refunded. DEFAULT now() would order
-- these incorrectly; enqueue sequence must preserve paid -> refunded.
BEGIN;
CREATE TEMP TABLE regression_payment_sequence (
  event_id text PRIMARY KEY,
  order_id text NOT NULL,
  payment_state text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL,
  event_sequence bigserial UNIQUE
) ON COMMIT DROP;
INSERT INTO regression_payment_sequence(event_id,order_id,payment_state,created_at)
  VALUES ('paid-event','order_test','paid','2026-09-07T12:00:02Z');
INSERT INTO regression_payment_sequence(event_id,order_id,payment_state,created_at)
  VALUES ('refund-event','order_test','refunded','2026-09-07T12:00:01Z');

DO $$
DECLARE actual text[];
BEGIN
  SELECT array_agg(payment_state ORDER BY created_at,event_id) INTO actual
  FROM regression_payment_sequence;
  IF actual IS DISTINCT FROM ARRAY['refunded','paid']::text[] THEN
    RAISE EXCEPTION 'regression_fixture_must_reproduce_old_timestamp_inversion';
  END IF;
  SELECT array_agg(payment_state ORDER BY event_sequence) INTO actual
  FROM regression_payment_sequence;
  IF actual IS DISTINCT FROM ARRAY['paid','refunded']::text[] THEN
    RAISE EXCEPTION 'sequence_must_preserve_accepted_callback_order';
  END IF;
  SELECT array_agg(candidate.payment_state ORDER BY candidate.event_sequence) INTO actual
  FROM regression_payment_sequence candidate
  WHERE candidate.status='pending' AND NOT EXISTS (
    SELECT 1 FROM regression_payment_sequence earlier
    WHERE earlier.order_id=candidate.order_id AND earlier.status='pending'
      AND earlier.event_sequence<candidate.event_sequence
  );
  IF actual IS DISTINCT FROM ARRAY['paid']::text[] THEN
    RAISE EXCEPTION 'refund_must_wait_for_pending_paid_even_when_paid_is_delayed_or_locked';
  END IF;
  UPDATE regression_payment_sequence SET status='sent' WHERE event_id='paid-event';
  SELECT array_agg(candidate.payment_state ORDER BY candidate.event_sequence) INTO actual
  FROM regression_payment_sequence candidate
  WHERE candidate.status='pending' AND NOT EXISTS (
    SELECT 1 FROM regression_payment_sequence earlier
    WHERE earlier.order_id=candidate.order_id AND earlier.status='pending'
      AND earlier.event_sequence<candidate.event_sequence
  );
  IF actual IS DISTINCT FROM ARRAY['refunded']::text[] THEN
    RAISE EXCEPTION 'refund_must_become_next_after_paid_ack';
  END IF;
END $$;
ROLLBACK;
