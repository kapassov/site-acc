import { NextResponse } from "next/server";

// Verification and cookie issuance are atomic in /api/customer. Keeping a
// second verifier would either expose Daribar tokens or recreate local OTP
// state, so this legacy route is intentionally retired.
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    { ok: false, reason: "use_customer_auth" },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
}
