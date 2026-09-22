import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * This endpoint previously accepted client-calculated totals and item counts.
 * All supported clients use /api/checkout, which requires a signed server
 * quote, so the legacy write path is intentionally unavailable.
 */
export async function POST() {
  return NextResponse.json(
    { error: "legacy_order_endpoint_disabled", checkout: "/api/checkout" },
    { status: 410, headers: NO_STORE },
  );
}
