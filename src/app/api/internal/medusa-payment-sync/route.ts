import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { flushMedusaPaymentSync } from "@/lib/payments/medusa-sync";

export const dynamic="force-dynamic";
export async function POST(request: Request) {
  const secret=process.env.MEDUSA_PAYMENT_SYNC_SECRET||"";
  const supplied=request.headers.get("x-internal-sync-key")||"";
  const expected=Buffer.from(secret), actual=Buffer.from(supplied);
  if(secret.length<32 || expected.length!==actual.length || !timingSafeEqual(expected,actual)) {
    return NextResponse.json({error:"not_found"},{status:404,headers:{"cache-control":"no-store"}});
  }
  try { return NextResponse.json(await flushMedusaPaymentSync(3),{headers:{"cache-control":"no-store"}}); }
  catch { return NextResponse.json({error:"sync_unavailable"},{status:503,headers:{"cache-control":"no-store"}}); }
}
