import { NextResponse } from "next/server";
import {
  applyKassaNotification,
  kassaConfig,
  verifyKassaNotification,
} from "@/lib/payments/kassa";

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY = 64 * 1024;

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY) {
    return NextResponse.json({ status: "error", message: "body_too_large" }, { status: 413, headers: NO_STORE });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY) {
    return NextResponse.json({ status: "error", message: "body_too_large" }, { status: 413, headers: NO_STORE });
  }
  try {
    const config = kassaConfig();
    const signature = request.headers.get("x-api-signature")
      || request.headers.get("x-kassa-signature")
      || "";
    if (!verifyKassaNotification(rawBody, signature, config.notificationKey)) {
      return NextResponse.json({ status: "error", message: "invalid_signature" }, { status: 401, headers: NO_STORE });
    }
    await applyKassaNotification(rawBody);
    return NextResponse.json({ status: "ok" }, { headers: NO_STORE });
  } catch (error) {
    const code = error instanceof Error ? error.message : "notification_failed";
    const clientError = /^kassa_(notification_invalid|payment_not_found|payment_mismatch)$/.test(code);
    return NextResponse.json(
      { status: "error", message: clientError ? code : "notification_failed" },
      { status: clientError ? 400 : 503, headers: NO_STORE },
    );
  }
}
