import { NextResponse } from "next/server";
import { publicPushConfig } from "@/lib/push/send";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" };

export async function GET() {
  const config = publicPushConfig();
  return NextResponse.json(
    {
      enabled: config.enabled,
      publicKey: config.publicKey,
      serviceWorkerUrl: "/sw.js",
      preferences: ["orders", "promos"],
      events: ["order.created", "app.download_interest", "test"],
    },
    { headers: NO_STORE },
  );
}
