import { NextResponse } from "next/server";
import { ordersAcceptingNow } from "@/lib/checkout/order-hours";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ acceptingOrders: ordersAcceptingNow(), opensAt: "08:00", closesAt: "21:45", timeZone: "Asia/Almaty" }, {
    headers: { "cache-control": "no-store" },
  });
}
