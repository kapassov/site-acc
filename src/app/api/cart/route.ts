/* eslint-disable @typescript-eslint/no-explicit-any */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { customerAuthMode } from "@/lib/customerAuthMode";
import { MEDUSA_REGION, MEDUSA_SALES_CHANNEL, MedusaStoreError, medusaStore } from "@/lib/medusaStore";
import { CartSyncInputError, MAX_CART_SYNC_ITEMS, normalizeCartSyncItems } from "@/lib/cartSync";
import { readBoundedJson, RequestBodyError } from "@/lib/httpBody";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const CART_COOKIE = "ms_cart";
const CUSTOMER_COOKIE = "ms_cust";
const NO_STORE = { "cache-control": "no-store" };
const DEMO_MODE = customerAuthMode() === "demo";
const MAX_CART_BODY_BYTES = 64 * 1024;
const MAX_CART_SYNC_REQUESTS = 60;
const CART_SYNC_WINDOW_MS = 60_000;
const COOKIE_SECURE = process.env.NODE_ENV === "production";

async function token() { return (await cookies()).get(CUSTOMER_COOKIE)?.value || null; }

async function retrieve(id: string, auth: string | null) {
  return (await medusaStore<{ cart: any }>(`/store/carts/${id}`, { token: auth, query: { fields: "+items.*" } })).cart;
}

async function ensureCart(auth: string | null) {
  const jar = await cookies();
  const current = jar.get(CART_COOKIE)?.value;
  if (current) {
    try { return await retrieve(current, auth); } catch (error) {
      if (!(error instanceof MedusaStoreError) || ![404, 409].includes(error.status)) throw error;
    }
  }
  const data = await medusaStore<{ cart: any }>("/store/carts", {
    method: "POST",
    token: auth,
    body: { region_id: MEDUSA_REGION, sales_channel_id: MEDUSA_SALES_CHANNEL, currency_code: "kzt" },
  });
  jar.set(CART_COOKIE, data.cart.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30, secure: COOKIE_SECURE });
  return data.cart;
}

export async function GET() {
  const jar = await cookies();
  if (DEMO_MODE) {
    jar.delete(CART_COOKIE);
    return NextResponse.json({ cart: null, demo: true }, { headers: NO_STORE });
  }
  const id = jar.get(CART_COOKIE)?.value;
  if (!id) return NextResponse.json({ cart: null }, { headers: NO_STORE });
  try {
    return NextResponse.json({ cart: await retrieve(id, await token()) }, { headers: NO_STORE });
  } catch {
    jar.delete(CART_COOKIE);
    return NextResponse.json({ cart: null }, { headers: NO_STORE });
  }
}

export async function POST(req: Request) {
  if (!rateLimit(`cart-sync:${clientIp(req)}`, MAX_CART_SYNC_REQUESTS, CART_SYNC_WINDOW_MS, Date.now())) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429, headers: NO_STORE });
  }
  let body: Record<string, unknown>;
  try {
    body = await readBoundedJson<Record<string, unknown>>(req, MAX_CART_BODY_BYTES);
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    const code = error instanceof RequestBodyError ? error.code : "invalid_json";
    return NextResponse.json({ error: code }, { status, headers: NO_STORE });
  }
  const action = String(body?.action || "sync");
  try {
    if (action === "clear") {
      (await cookies()).delete(CART_COOKIE);
      return NextResponse.json({ cart: null }, { headers: NO_STORE });
    }
    if (action !== "sync") return NextResponse.json({ error: "bad_action" }, { status: 400, headers: NO_STORE });
    if (DEMO_MODE) {
      (await cookies()).delete(CART_COOKIE);
      return NextResponse.json({ cart: null, demo: true, synced: false }, { headers: NO_STORE });
    }
    const desired = normalizeCartSyncItems(body.items);
    const jar = await cookies();
    if (!desired.length && !jar.get(CART_COOKIE)?.value) return NextResponse.json({ cart: null }, { headers: NO_STORE });
    let cart = await ensureCart(await token());
    const current: any[] = Array.isArray(cart?.items) ? cart.items : [];
    if (current.length > MAX_CART_SYNC_ITEMS) {
      return NextResponse.json({ error: "cart_too_large" }, { status: 409, headers: NO_STORE });
    }
    const wanted = new Map(desired.map((item) => [item.variantId, item.quantity]));

    for (const line of current) {
      const variantId = String(line?.variant_id || line?.variant?.id || "");
      const quantity = wanted.get(variantId);
      if (!quantity) {
        const data = await medusaStore<{ parent: any }>(`/store/carts/${cart.id}/line-items/${line.id}`, { method: "DELETE", token: await token() });
        cart = data.parent || cart;
      } else if (Number(line.quantity) !== quantity) {
        const data = await medusaStore<{ cart: any }>(`/store/carts/${cart.id}/line-items/${line.id}`, { method: "POST", token: await token(), body: { quantity } });
        cart = data.cart;
      }
      wanted.delete(variantId);
    }
    for (const [variant_id, quantity] of wanted) {
      const data = await medusaStore<{ cart: any }>(`/store/carts/${cart.id}/line-items`, { method: "POST", token: await token(), body: { variant_id, quantity } });
      cart = data.cart;
    }
    return NextResponse.json({ cart }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof CartSyncInputError) {
      return NextResponse.json({ error: error.message }, { status: 400, headers: NO_STORE });
    }
    const status = error instanceof MedusaStoreError ? Math.max(400, error.status) : 502;
    return NextResponse.json({ error: "cart_sync_failed", message: error instanceof Error ? error.message : "backend unavailable" }, { status, headers: NO_STORE });
  }
}
