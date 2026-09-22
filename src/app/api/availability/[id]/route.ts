import { NextResponse } from "next/server";
import { getMedusaProductsByIds, getPharmacyPrices } from "@/lib/medusa";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { daribarSkuForMedusaProduct, mappedDaribarPharmacies } from "@/lib/daribar/delivery-mapping";
import { searchDaribarProductsV3 } from "@/lib/daribar/product-search-v3";
export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!rateLimit(`availability:${clientIp(request)}`, 30, 60_000, Date.now())) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: NO_STORE });
  const { id } = await params;
  const city = (new URL(request.url).searchParams.get("city") || "Алматы").trim();
  if (!/^prod_[A-Za-z0-9]+$/.test(id) || !/^[\p{L}\p{M} .'-]{1,100}$/u.test(city)) return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  try {
    const [info, products, sku, mapped] = await Promise.all([
      getPharmacyPrices(id),
      getMedusaProductsByIds([id]),
      daribarSkuForMedusaProduct(id),
      mappedDaribarPharmacies(city),
    ]);
    if (!sku || mapped.size === 0) {
      return NextResponse.json({ error: "availability_unavailable" }, { status: 503, headers: NO_STORE });
    }
    const live = await searchDaribarProductsV3({
      city,
      items: [{ sku, countDesired: 1_000_000, priority: 1 }],
      availability: "all",
      replacements: false,
      limit: 1_000,
    });
    const ownOffers = new Map(info && !info.stale && info.complete
      ? info.pharmacies.map((pharmacy) => [pharmacy.id, pharmacy]) : []);
    const displayPrice = products[0] && !products[0].priceTBD && products[0].price > 0
      ? products[0].price : undefined;
    const pharmacies = live.flatMap((row) => {
      const local = mapped.get(row.sourceCode);
      const offer = local ? ownOffers.get(local.id) : undefined;
      const exact = row.products.find((product) => product.sku === sku);
      const medusaQuantity = Math.floor(Number(offer?.availableQuantity));
      const quantity = exact?.quantity && exact.quantity > 0
        ? (Number.isSafeInteger(medusaQuantity) && medusaQuantity > 0
          ? Math.min(exact.quantity, medusaQuantity) : exact.quantity)
        : 0;
      if (!local || quantity < 1) return [];
      return [{
        sourceCode: local.id,
        name: local.name,
        city: local.city,
        address: local.address,
        lat: row.lat ?? offer?.lat,
        lon: row.lon ?? offer?.lon,
        hours: row.openingHours ?? offer?.hours,
        quantity,
        ...(offer && offer.price > 0 ? { price: offer.price } : displayPrice ? { price: displayPrice } : {}),
      }];
    }).sort((left, right) => (left.price ?? Number.MAX_SAFE_INTEGER) - (right.price ?? Number.MAX_SAFE_INTEGER)
      || left.name.localeCompare(right.name, "ru"));
    return NextResponse.json({
      city,
      total: pharmacies.length,
      pharmacies,
      partial: false,
      stale: false,
      source: "medusa_last_known_price+daribar_v3_stock",
      sourceDate: info?.sourceDate ?? products[0]?.stockSourceDate,
      snapshotId: info?.snapshotId,
      liveCheckedAt: new Date().toISOString(),
    }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "availability_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
