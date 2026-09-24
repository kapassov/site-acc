import { getMedusaPharmacies } from "../../../lib/medusa-pharmacies.ts";
import { servesDaribarCatalog } from "../../../lib/catalog-provider.ts";
import { mappedDaribarPharmacies } from "../../../lib/daribar/delivery-mapping.ts";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const city = params.get("scope") === "all" ? undefined : (params.get("city") || "Алматы").trim();
  if (city && !/^[\p{L}\p{M} .'-]{1,100}$/u.test(city)) return Response.json({ error: "invalid_city", pharmacies: [] }, { status: 400 });
  try {
    if (servesDaribarCatalog()) {
      const mapped = await mappedDaribarPharmacies(city);
      const pharmacies = [...mapped.values()].map((pharmacy) => ({
        sourceCode: pharmacy.id,
        name: pharmacy.name,
        city: pharmacy.city,
        address: pharmacy.address,
        hours: pharmacy.hours || "",
        lat: pharmacy.lat,
        lon: pharmacy.lon,
      }));
      return Response.json({ city, pharmacies, source: "daribar", degraded: false }, {
        headers: { "cache-control": "public, max-age=30, s-maxage=60" },
      });
    }
    const pharmacies = await getMedusaPharmacies(city);
    return Response.json({ city, pharmacies, source: "medusa", degraded: false }, { headers: { "cache-control": "public, max-age=30, s-maxage=60" } });
  } catch {
    return Response.json({ error: "pharmacies_unavailable", pharmacies: [], source: servesDaribarCatalog() ? "daribar" : "medusa", degraded: true }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
