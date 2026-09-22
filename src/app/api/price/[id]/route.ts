import { NextResponse } from "next/server";
import { getPrices } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Минимальная цена товара по аптекам — для ленивой подгрузки на карточках листинга. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const info = await getPrices(id);
  if (!info) {
    return NextResponse.json(
      { error: "price_temporarily_unavailable" },
      { status: 503, headers: { "cache-control": "no-store", "retry-after": "5" } },
    );
  }
  return NextResponse.json(
    { min: info.min, max: info.max, count: info.count, pharmacies: info.pharmacies, validUntil: info.validUntil },
    { headers: { "cache-control": "no-store" } },
  );
}
