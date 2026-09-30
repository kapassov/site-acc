import { cookies } from "next/headers";
import { secureMedusaBaseUrl } from "@/lib/medusaUrl";
import { phoneDigits } from "@/lib/phone";

const BASE = secureMedusaBaseUrl(process.env.MEDUSA_URL);
const PK = process.env.MEDUSA_PUBLISHABLE_KEY || "";
const CUSTOMER_COOKIE = "ms_cust";

export type CustomerSession =
  | { status: "authenticated"; customerId: string; token: string; phone: string; name: string; email: string | null }
  | { status: "anonymous" }
  | { status: "unavailable" };

function bearer(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/** Validate the web cookie or mobile bearer token against Medusa. */
export async function customerSession(req: Request): Promise<CustomerSession> {
  const token = bearer(req) || (await cookies()).get(CUSTOMER_COOKIE)?.value || null;
  if (!token) return { status: "anonymous" };
  if (!BASE || !PK || process.env.MEDUSA_ENABLED !== "true") return { status: "unavailable" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${BASE}/store/customers/me`, {
      headers: {
        authorization: `Bearer ${token}`,
        "x-publishable-api-key": PK,
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 404) return { status: "anonymous" };
    if (!response.ok) return { status: "unavailable" };
    const payload = await response.json().catch(() => null) as { customer?: {
      id?: unknown; phone?: unknown; first_name?: unknown; last_name?: unknown; email?: unknown;
      metadata?: Record<string, unknown> | null;
    } } | null;
    const customerId = typeof payload?.customer?.id === "string" ? payload.customer.id.trim() : "";
    const phone = phoneDigits(typeof payload?.customer?.phone === "string" ? payload.customer.phone : "");
    const name = [payload?.customer?.first_name, payload?.customer?.last_name]
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      .map((value) => value.trim()).join(" ").slice(0, 100);
    const rawEmail = typeof payload?.customer?.email === "string" ? payload.customer.email.trim() : "";
    const contactEmail = typeof payload?.customer?.metadata?.contact_email === "string"
      ? payload.customer.metadata.contact_email.trim() : "";
    const email = contactEmail || (rawEmail.endsWith("@phone.darihana.kz") ? null : rawEmail || null);
    return customerId && /^7\d{10}$/.test(phone)
      ? { status: "authenticated", customerId, token, phone, name, email }
      : { status: "anonymous" };
  } catch {
    return { status: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}
