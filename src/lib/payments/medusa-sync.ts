import type { PoolClient } from "pg";
import { ordersDatabasePool } from "@/lib/orders/store";
import { medusaCommerce, StandardNCommerceError } from "@/lib/standardn-commerce";

type PaymentState = "paid" | "failed" | "refunded";
type Event = {
  event_id: string; order_id: string; transaction_id: string;
  payment_state: PaymentState; amount: string; currency: "KZT"; attempts: number;
};

/** Called only inside the transaction accepting a cryptographically verified Kassa callback.
 * The caller holds the payment-row FOR UPDATE lock. event_sequence is assigned
 * here by PostgreSQL, preserving accepted state order even when transaction
 * start times or system clocks do not match lock-acquisition order.
 */
export async function queueMedusaPayment(client: PoolClient, input: {
  eventId: string; orderId: string; transactionId: string; state: string; amount: number;
}): Promise<void> {
  if (!["paid", "failed", "refunded"].includes(input.state)) return;
  await client.query(`
    INSERT INTO medusa_payment_sync (event_id,order_id,transaction_id,payment_state,amount,currency)
    SELECT $1,o.id,$3,$4,$5,'KZT' FROM site_orders o
    WHERE o.id=$2 AND o.source_system='medusa' AND o.metadata->>'provider'='medusa'
    ON CONFLICT (event_id) DO NOTHING
  `, [input.eventId,input.orderId,input.transactionId,input.state,input.amount]);
}

export async function flushMedusaPaymentSync(limit = 3): Promise<{ sent: number; failed: number }> {
  const db = await ordersDatabasePool();
  const claimed = await db.query<Event>(`
    UPDATE medusa_payment_sync SET locked_until=now()+interval '3 minutes',attempts=attempts+1
    WHERE event_id IN (
      SELECT candidate.event_id FROM medusa_payment_sync candidate
      WHERE candidate.status='pending' AND candidate.available_at<=now()
        AND (candidate.locked_until IS NULL OR candidate.locked_until<now())
        AND NOT EXISTS (
          SELECT 1 FROM medusa_payment_sync earlier WHERE earlier.order_id=candidate.order_id
            AND earlier.status='pending'
            AND earlier.event_sequence<candidate.event_sequence
        )
      ORDER BY candidate.event_sequence LIMIT $1 FOR UPDATE SKIP LOCKED
    ) RETURNING event_id,order_id,transaction_id,payment_state,amount,currency,attempts
  `, [Math.max(1,Math.min(5,limit))]);
  let sent=0,failed=0;
  for (const event of claimed.rows) {
    try {
      await medusaCommerce("/store/standardn/payment", {
        orderId:event.order_id,transactionId:event.transaction_id,state:event.payment_state,
        amount:Number(event.amount),currency:event.currency,idempotencyKey:event.event_id,
      });
      await db.query("UPDATE medusa_payment_sync SET status='sent',sent_at=now(),locked_until=NULL,last_error=NULL WHERE event_id=$1",[event.event_id]);
      sent++;
    } catch(error) {
      const code=error instanceof StandardNCommerceError ? error.code : "payment_sync_unavailable";
      await db.query(`UPDATE medusa_payment_sync SET locked_until=NULL,last_error=$2,
        available_at=now()+($3*interval '1 second') WHERE event_id=$1`,
      [event.event_id,code,Math.min(3600,30*2**Math.min(event.attempts,7))]);
      failed++;
    }
  }
  return {sent,failed};
}
