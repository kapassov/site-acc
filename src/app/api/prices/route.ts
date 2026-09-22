import { NextResponse } from "next/server";
import { getPharmacyPrices } from "@/lib/medusa";

export const dynamic = "force-dynamic";

const MAX_IDS = 6;
const CONCURRENCY = 3;

function validProductId(id: string): boolean {
  return /^prod_[A-Za-z0-9]+$/.test(id) && id.length <= 128;
}

/** Пакет минимальных цен для видимых карточек вместо отдельного HTTP на каждую. */
export async function GET(request: Request) {
  const ids = [...new Set((new URL(request.url).searchParams.get("ids") || "").split(","))]
    .map((id) => id.trim())
    .filter((id) => validProductId(id))
    .slice(0, MAX_IDS);

  if (ids.length === 0) {
    return NextResponse.json({ prices: {} }, { headers: { "cache-control": "no-store" } });
  }

  const prices: Record<string, { min: number | null; max: number | null; count: number; validUntil?: string }> = {};
  const failedIds: string[] = [];
  for (let offset = 0; offset < ids.length; offset += CONCURRENCY) {
    const chunk = ids.slice(offset, offset + CONCURRENCY);
    const values = await Promise.all(chunk.map((id) => getPharmacyPrices(id).catch(() => null)));
    chunk.forEach((id, index) => {
      const info = values[index];
      if (!info) failedIds.push(id);
      prices[id] = { min: info?.min ?? null, max: info?.max ?? null, count: info?.count ?? 0, validUntil: info?.validUntil };
    });
  }

  return NextResponse.json(
    { prices, failedIds },
    {
      headers: {
        "cache-control": "no-store",
        ...(failedIds.length > 0 ? { "x-data-state": "partial" } : {}),
      },
    },
  );
}
