import { NextResponse } from "next/server";
import { listOrders, updateOrderStatus } from "@/lib/orders/store";
import { ORDER_STATUSES } from "@/lib/content/defaults";
import { isStrongRuntimeSecret } from "@/lib/serverSecrets";

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" };

function authorized(req: Request) {
  const expected = process.env.ADMIN_TOKEN;
  return Boolean(isStrongRuntimeSecret(expected) && req.headers.get("x-admin-token") === expected);
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  try {
    return NextResponse.json({ orders: await listOrders() }, { headers: NO_STORE });
  } catch (error) {
    console.error("[api/admin/orders] list failed", error);
    return NextResponse.json({ error: "orders_backend_unavailable" }, { status: 503, headers: NO_STORE });
  }
}

export async function PATCH(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  const body = await req.json().catch(() => null) as { id?: string; status?: string } | null;
  const id = String(body?.id || "");
  const status = String(body?.status || "");
  if (!id || !ORDER_STATUSES.includes(status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400, headers: NO_STORE });
  }
  try {
    const order = await updateOrderStatus(id, status);
    if (!order) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ order }, { headers: NO_STORE });
  } catch (error) {
    console.error("[api/admin/orders] status update failed", error);
    return NextResponse.json({ error: "orders_backend_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
