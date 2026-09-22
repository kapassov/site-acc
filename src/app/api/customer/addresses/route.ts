/* eslint-disable @typescript-eslint/no-explicit-any */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { medusaStore } from "@/lib/medusaStore";
import { readBoundedJson, RequestBodyError } from "@/lib/httpBody";

export const dynamic = "force-dynamic";
const COOKIE = "ms_cust";
const NO_STORE = { "cache-control": "no-store" };
const MAX_ADDRESS_BODY_BYTES = 4_096;
const MAX_ADDRESS_LENGTH = 240;
const MAX_CITY_LENGTH = 80;

async function auth() { return (await cookies()).get(COOKIE)?.value || null; }
function mapped(raw: any[]) {
  return (raw || []).map((a) => ({ id: String(a.id || ""), label: [a.city, a.address_1, a.address_2].filter(Boolean).join(", ") }));
}

export async function GET() {
  const token = await auth();
  if (!token) return NextResponse.json({ addresses: [] }, { headers: NO_STORE });
  try {
    const data = await medusaStore<{ addresses?: any[] }>("/store/customers/me/addresses", { token, query: { limit: 100 } });
    return NextResponse.json({ addresses: mapped(data.addresses || []) }, { headers: NO_STORE });
  } catch { return NextResponse.json({ addresses: [] }, { headers: NO_STORE }); }
}

export async function POST(req: Request) {
  const token = await auth();
  if (!token) return NextResponse.json({ error: "no_session" }, { status: 401, headers: NO_STORE });
  let body: Record<string, unknown>;
  try {
    body = await readBoundedJson<Record<string, unknown>>(req, MAX_ADDRESS_BODY_BYTES);
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    const code = error instanceof RequestBodyError ? error.code : "invalid_json";
    return NextResponse.json({ error: code }, { status, headers: NO_STORE });
  }
  const address = String(body.address || "").trim();
  const city = String(body.city || "Алматы").trim();
  if (
    !address
    || address.length > MAX_ADDRESS_LENGTH
    || !city
    || city.length > MAX_CITY_LENGTH
  ) {
    return NextResponse.json({ error: "bad_address" }, { status: 400, headers: NO_STORE });
  }
  const me = await medusaStore<{ customer: any }>("/store/customers/me", { token });
  const data = await medusaStore<{ customer: any }>("/store/customers/me/addresses", {
    method: "POST", token,
    body: { first_name: me.customer?.first_name || "Покупатель", last_name: me.customer?.last_name || "", address_1: address, city, country_code: "kz", postal_code: "050000", phone: me.customer?.phone || "" },
  });
  return NextResponse.json({ addresses: mapped(data.customer?.addresses || []) }, { status: 201, headers: NO_STORE });
}

export async function DELETE(req: Request) {
  const token = await auth();
  if (!token) return NextResponse.json({ error: "no_session" }, { status: 401, headers: NO_STORE });
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^ca_[A-Za-z0-9]+$/.test(id)) return NextResponse.json({ error: "bad_address" }, { status: 400, headers: NO_STORE });
  await medusaStore(`/store/customers/me/addresses/${id}`, { method: "DELETE", token });
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
