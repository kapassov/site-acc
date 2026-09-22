import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { ordersDatabasePool, type StoredOrder } from "@/lib/orders/store";
import { queueMedusaPayment, flushMedusaPaymentSync } from "./medusa-sync";
import {
  kassaConfig,
  kassaPaymentState,
  kassaReturnToken,
  parseKassaNotification,
  verifyKassaReturnToken,
  type KassaConfig,
  type KassaEnv,
} from "./kassaContract";

export {
  kassaConfig,
  kassaEnabled,
  kassaReturnToken,
  verifyKassaNotification,
  verifyKassaReturnToken,
} from "./kassaContract";

const RESPONSE_LIMIT = 64 * 1024;
const FINAL_STATUSES = new Set(["successful", "refund"]);

async function reservePayment(order: StoredOrder, config: KassaConfig) {
  const db = await ordersDatabasePool();
  const partnerPaymentId = `ass-${order.id}`;
  const result = await db.query<{
    order_id: string; partner_payment_id: string; status: string; payment_url: string | null;
  }>(`
    INSERT INTO kassa_payments (
      order_id, partner_payment_id, amount, currency_code, status, is_test
    ) VALUES ($1, $2, $3, $4, 'creating', $5)
    ON CONFLICT (order_id) DO UPDATE SET order_id = EXCLUDED.order_id
    RETURNING order_id, partner_payment_id, status, payment_url
  `, [order.id, partnerPaymentId, order.sum, "KZT", config.testMode]);
  return result.rows[0];
}

export async function createKassaPayment(
  order: StoredOrder,
  env: KassaEnv = process.env,
  request: typeof fetch = fetch,
): Promise<{ redirect: string; returnToken: string }> {
  const config = kassaConfig(env);
  if (order.demo || order.sum < 1) throw new Error("kassa_order_invalid");
  const reservation = await reservePayment(order, config);
  const returnToken = kassaReturnToken(order.id, config.returnSecret);
  if (reservation.payment_url) return { redirect: reservation.payment_url, returnToken };
  if (reservation.status !== "creating") throw new Error("kassa_payment_not_creatable");

  const resultUrl = `${config.publicOrigin}/payment/result?order=${encodeURIComponent(order.id)}&token=${encodeURIComponent(returnToken)}`;
  const payload = {
    partner_payment_id: reservation.partner_payment_id,
    order: { currency: "KZT", amount: order.sum, description: `Заказ ${order.n}` },
    settings: {
      project_id: config.projectId,
      success_url: `${resultUrl}&state=success`,
      fail_url: `${resultUrl}&state=failed`,
      back_url: `${resultUrl}&state=back`,
      locale: "ru",
      capture: true,
      is_test: config.testMode,
    },
    custom_parameters: { order_id: order.id },
  };
  const response = await request(`${config.host}/v1/payment/create`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
    headers: {
      "authorization": `Bearer ${config.apiKey}`,
      "content-type": "application/json",
      "accept": "application/json",
      "user-agent": "Apteka-So-Sklada/1.0",
    },
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > RESPONSE_LIMIT) throw new Error("kassa_response_too_large");
  if (!response.ok) throw new Error(`kassa_http_${response.status}`);
  let data: Record<string, unknown>;
  try { data = JSON.parse(raw) as Record<string, unknown>; } catch { throw new Error("kassa_response_invalid"); }
  const redirect = String(data.payment_url || "");
  const redirectUrl = new URL(redirect);
  const providerOrder = data.order as Record<string, unknown> | undefined;
  if (redirectUrl.protocol !== "https:" || String(data.token || "").length < 8
      || !data.id || Number(providerOrder?.amount) !== order.sum
      || String(providerOrder?.currency || "").toUpperCase() !== "KZT") {
    throw new Error("kassa_response_invalid");
  }
  const db = await ordersDatabasePool();
  // A signed callback can bind/advance this payment before create returns.
  // Save its URL without downgrading that newer state, and never attach a
  // different provider transaction to the reserved site order.
  const saved = await db.query(`
    UPDATE kassa_payments
    SET provider_payment_id = COALESCE(provider_payment_id, $2),
        provider_token = COALESCE(provider_token, $3),
        payment_url = COALESCE(payment_url, $4),
        status = CASE WHEN status = 'creating' THEN $5 ELSE status END,
        updated_at = now()
    WHERE order_id = $1
      AND (provider_payment_id IS NULL OR provider_payment_id = $2)
      AND (provider_token IS NULL OR provider_token = $3)
      AND (payment_url IS NULL OR payment_url = $4)
  `, [order.id, String(data.id), String(data.token), redirect, String(data.status || "init")]);
  if (saved.rowCount !== 1) throw new Error("kassa_payment_state_conflict");
  return { redirect, returnToken };
}

async function updateOrderPaymentState(
  client: PoolClient,
  orderId: string,
  providerStatus: string,
): Promise<void> {
  const state = kassaPaymentState(providerStatus);
  await client.query(`
    UPDATE site_orders
    SET metadata = metadata || jsonb_build_object(
          'payment', 'card',
          'payment_provider', 'kassa.com',
          'payment_status', $2::text,
          'kassa_payment_status', $3::text
        ),
        updated_at = now()
    WHERE id = $1
  `, [orderId, state, providerStatus]);
  await client.query(`
    UPDATE integration_outbox
    SET payload = jsonb_set(payload, '{payment_status}', to_jsonb($2::text), true),
        epharm_request = CASE
          WHEN epharm_request IS NULL THEN NULL
          ELSE jsonb_set(epharm_request, '{paymentStatus}', to_jsonb($2::text), true)
        END,
        updated_at = now()
    WHERE topic = 'epharm.order.created'
      AND aggregate_id = $1
      AND status <> 'sent'
  `, [orderId, state]);
}

export async function applyKassaNotification(rawBody: string, env: KassaEnv = process.env): Promise<void> {
  kassaConfig(env);
  if (Buffer.byteLength(rawBody, "utf8") > RESPONSE_LIMIT) throw new Error("kassa_notification_too_large");
  let decoded: unknown;
  try { decoded = JSON.parse(rawBody); } catch { throw new Error("kassa_notification_invalid"); }
  const notification = parseKassaNotification(decoded);
  const bodySha = createHash("sha256").update(rawBody).digest("hex");
  const db = await ordersDatabasePool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{
      order_id: string; amount: string; currency_code: string; status: string; is_test: boolean;
    }>(`
      SELECT order_id, amount, currency_code, status, is_test
      FROM kassa_payments
      WHERE ($1::text IS NOT NULL AND partner_payment_id = $1)
         OR provider_token = $2
      FOR UPDATE
    `, [notification.partner_payment_id || null, notification.token]);
    if (found.rowCount !== 1) throw new Error("kassa_payment_not_found");
    const payment = found.rows[0];
    if (Number(payment.amount) !== notification.order.amount
        || payment.currency_code.toUpperCase() !== notification.order.currency
        || (notification.is_test !== undefined && payment.is_test !== notification.is_test)) {
      throw new Error("kassa_payment_mismatch");
    }
    const inserted = await client.query(`
      INSERT INTO kassa_payment_notifications (
        body_sha256, order_id, notification_type, provider_status
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT DO NOTHING
    `, [bodySha, payment.order_id, notification.notification_type, notification.status]);
    if (inserted.rowCount === 1) {
      const nextStatus = FINAL_STATUSES.has(payment.status) && notification.status !== "refund"
        ? payment.status
        : notification.status;
      await client.query(`
        UPDATE kassa_payments
        SET provider_payment_id = COALESCE(provider_payment_id, $2),
            provider_token = COALESCE(provider_token, $3), status = $4,
            status_description = $5, updated_at = now()
        WHERE order_id = $1
      `, [payment.order_id, String(notification.id), notification.token, nextStatus, notification.status_description || null]);
      await updateOrderPaymentState(client, payment.order_id, nextStatus);
      await queueMedusaPayment(client, {
        eventId: bodySha, orderId: payment.order_id, transactionId: String(notification.id),
        state: kassaPaymentState(nextStatus), amount: Number(payment.amount),
      });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  // The event is durable before delivery. A timer retries temporary Medusa
  // outages; never ask Kassa to recreate or charge the customer's payment.
  await flushMedusaPaymentSync(1).catch(() => {
    console.error("[payments] Medusa reconciliation is queued for retry");
  });
}

export async function kassaPaymentStatus(orderId: string, token: string, env: KassaEnv = process.env) {
  const config = kassaConfig(env);
  if (!verifyKassaReturnToken(orderId, token, config.returnSecret)) throw new Error("kassa_return_token_invalid");
  const db = await ordersDatabasePool();
  const result = await db.query<{ status: string }>(
    "SELECT status FROM kassa_payments WHERE order_id = $1",
    [orderId],
  );
  if (result.rowCount !== 1) throw new Error("kassa_payment_not_found");
  const status = result.rows[0].status;
  return { status, state: kassaPaymentState(status), final: ["successful", "error", "canceled", "refund"].includes(status) };
}
