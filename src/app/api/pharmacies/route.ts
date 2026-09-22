import { getMedusaPharmacies } from "../../../lib/medusa-pharmacies.ts";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const city = params.get("scope") === "all" ? undefined : (params.get("city") || "Алматы").trim();
  if (city && !/^[\p{L}\p{M} .'-]{1,100}$/u.test(city)) return Response.json({ error: "invalid_city", pharmacies: [] }, { status: 400 });
  try {
    const pharmacies = await getMedusaPharmacies(city);
    return Response.json({ city, pharmacies, source: "medusa", degraded: false }, { headers: { "cache-control": "public, max-age=30, s-maxage=60" } });
  } catch {
    return Response.json({ error: "pharmacies_unavailable", pharmacies: [], source: "medusa", degraded: true }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
