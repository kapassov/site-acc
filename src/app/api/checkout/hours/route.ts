import { NextResponse } from "next/server";
import { ordersAcceptingNow } from "@/lib/checkout/order-hours";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    acceptingOrders: ordersAcceptingNow(),
    opensAt: "09:00",
    closesAt: "21:00",
    orderCutoff: "20:30",
    timeZone: "Asia/Almaty",
  }, {
    headers: { "cache-control": "no-store" },
  });
}
