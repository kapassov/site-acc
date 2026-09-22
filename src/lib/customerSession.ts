import { cookies } from "next/headers";
import { DARIBAR_ACCESS_COOKIE, getDaribarUser } from "@/lib/daribar/auth";
import { daribarCustomerId } from "@/lib/daribar/customer-identity";
import { phoneDigits } from "@/lib/phone";

export type CustomerSession =
  | { status: "authenticated"; customerId: string }
  | { status: "anonymous" }
  | { status: "unavailable" };

function bearer(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function providerStatus(error: unknown): number {
  return typeof (error as { status?: unknown })?.status === "number"
    ? (error as { status: number }).status
    : 0;
}

/** Validate a mobile bearer token or the web HttpOnly cookie against Daribar. */
export async function customerSession(req: Request): Promise<CustomerSession> {
  const token = bearer(req) || (await cookies()).get(DARIBAR_ACCESS_COOKIE)?.value || "";
  if (!token) return { status: "anonymous" };

  try {
    const profile = await getDaribarUser(token);
    const phone = phoneDigits(profile.phone || "");
    return phone.length === 11
      ? { status: "authenticated", customerId: daribarCustomerId(phone) }
      : { status: "anonymous" };
  } catch (error) {
    return providerStatus(error) === 401
      ? { status: "anonymous" }
      : { status: "unavailable" };
  }
}
