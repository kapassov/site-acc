import { NextResponse } from "next/server";
import { setDaribarAuthCookies } from "@/lib/daribar/auth";
import { DaribarCustomerSessionError, daribarCustomerSession } from "@/lib/daribar/customer-session";
import { getDaribarCustomerOrder, type DaribarOrderSnapshot } from "@/lib/daribar/order-status";
import { medusaMediaUrl } from "@/lib/media-url";
import { customerOrderSummary, providerMetadataPatch } from "@/lib/orders/customer-view";
import { getCustomerOrder, ordersDatabasePool, updateStoredOrderMetadata, type StoredOrder } from "@/lib/orders/store";

export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "cache-control": "private, no-store", vary: "Cookie, Authorization" };

type CatalogRow = { id: string; handle: string; title: string; thumbnail_url: string | null };
type LocalLine = { productId: string; sku: string; title: string; quantity: number; unitPrice: number };

function cleanText(value: unknown, max = 500): string {
  return String(value ?? "").trim().slice(0, max);
}

function localLines(order: StoredOrder): LocalLine[] {
  const values = Array.isArray(order.metadata?.line_items) ? order.metadata.line_items : [];
  return values.slice(0, 200).flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const line = value as Record<string, unknown>;
    const quantity = Math.max(1, Math.round(Number(line.quantity || 1)));
    const unitPrice = Math.max(0, Math.round(Number(line.unit_price || 0)));
    return [{
      productId: cleanText(line.product_id, 256),
      sku: cleanText(line.sku, 160),
      title: cleanText(line.title || line.name),
      quantity: Number.isSafeInteger(quantity) ? quantity : 1,
      unitPrice: Number.isSafeInteger(unitPrice) ? unitPrice : 0,
    }];
  });
}

async function catalogRows(productIds: string[]): Promise<Map<string, CatalogRow>> {
  const ids = [...new Set(productIds.filter(Boolean))].slice(0, 200);
  if (!ids.length) return new Map();
  try {
    const db = await ordersDatabasePool();
    const result = await db.query<CatalogRow>(`
      SELECT id::text, handle, title, thumbnail_url
      FROM catalog_products
      WHERE id::text = ANY($1::text[])
    `, [ids]);
    return new Map(result.rows.map((row) => [row.id, row]));
  } catch (error) {
    console.warn("[customer/order] catalog enrichment unavailable", {
      code: error instanceof Error ? error.message.slice(0, 100) : "unknown",
    });
    return new Map();
  }
}

function safeUrl(value: unknown): string | undefined {
  const url = cleanText(value, 2_048);
  return url.startsWith("https://") ? url : undefined;
}

async function orderDetail(order: StoredOrder, snapshot?: DaribarOrderSnapshot) {
  const lines = localLines(order);
  const catalog = await catalogRows(lines.map((line) => line.productId));
  const metadata = order.metadata || {};
  return {
    ...customerOrderSummary(order, snapshot),
    createdAt: order.createdAt,
    deliveryMethod: order.delivery,
    pickupCode: order.code || null,
    pharmacy: {
      id: cleanText(metadata.pharmacy_id, 256),
      name: snapshot?.source?.name || cleanText(metadata.pharmacy_name, 300),
      address: snapshot?.source?.address || cleanText(metadata.pharmacy_address, 500),
    },
    delivery: {
      address: cleanText(metadata.delivery_address, 500),
      provider: cleanText(metadata.delivery_provider, 100),
      eta: cleanText(metadata.delivery_eta, 100),
      status: snapshot?.deliveryStatus || snapshot?.claimStatus || cleanText(metadata.delivery_claim_status, 100),
      trackingUrl: safeUrl(snapshot?.trackingUrl || metadata.tracking_url || metadata.delivery_tracking_url) || null,
    },
    payment: {
      method: cleanText(metadata.payment, 100),
      status: snapshot?.paid === true ? "paid" : snapshot?.paymentStatus || cleanText(metadata.payment_status, 100),
    },
    providerStatus: snapshot?.rawStatus || snapshot?.status || cleanText(metadata.provider_status, 100),
    providerAvailable: Boolean(snapshot),
    items: lines.map((line, index) => {
      const product = catalog.get(line.productId);
      const provider = snapshot?.items[index];
      return {
        productId: line.productId,
        sku: line.sku || provider?.sku || "",
        title: product?.title || line.title || provider?.name || line.sku || "Товар",
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        total: line.unitPrice * line.quantity,
        handle: product?.handle || null,
        image: medusaMediaUrl(product?.thumbnail_url) || null,
      };
    }),
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await daribarCustomerSession(request);
  } catch (error) {
    const authError = error instanceof DaribarCustomerSessionError ? error : null;
    const response = NextResponse.json({ error: authError?.message || "orders_unavailable" }, {
      status: authError?.status || 502, headers: PRIVATE_HEADERS,
    });
    if (authError?.rotatedTokens) setDaribarAuthCookies(response, authError.rotatedTokens);
    return response;
  }
  if (!session) return NextResponse.json({ error: "daribar_auth_required" }, { status: 401, headers: PRIVATE_HEADERS });

  const { id } = await params;
  const order = await getCustomerOrder(session.customerId, decodeURIComponent(id));
  if (!order || order.demo === true) return NextResponse.json({ error: "order_not_found" }, { status: 404, headers: PRIVATE_HEADERS });

  let snapshot: DaribarOrderSnapshot | undefined;
  if (order.sourceSystem === "daribar") {
    try {
      snapshot = await getDaribarCustomerOrder(session.accessToken, order.sourceOrderId);
      await updateStoredOrderMetadata(order.id, providerMetadataPatch(snapshot));
    } catch (error) {
      console.warn("[customer/order] Daribar detail unavailable", {
        code: error instanceof Error ? error.message.slice(0, 100) : "unknown",
        orderId: order.sourceOrderId,
      });
    }
  }
  const response = NextResponse.json({ order: await orderDetail(order, snapshot) }, { headers: PRIVATE_HEADERS });
  if (session.rotatedTokens) setDaribarAuthCookies(response, session.rotatedTokens);
  return response;
}
