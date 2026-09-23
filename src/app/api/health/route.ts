import { NextResponse } from "next/server";
import { inspectPostgresHealth } from "@/lib/database-health";
import { dependencyReadiness } from "@/lib/health-readiness";
import {
  checkMedusaConnection,
  getCategoryTree,
  getMedusaProducts,
  getMedusaRuntimeStats,
} from "@/lib/medusa";
import { storefrontCatalogProvider } from "@/lib/catalog-provider";
import { getDaribarProducts } from "@/lib/daribar/catalog";
import { readDaribarCatalogDatabase } from "@/lib/daribar/catalog-db";
import { getTypesenseIndexStatus } from "@/lib/search/typesense-client";
import { getStorefrontNavigation } from "@/lib/storefront-catalog";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "cache-control": "no-store" };

/**
 * The default endpoint is a cheap liveness probe: it proves that the Next.js
 * event loop can serve requests and is safe for automatic process recovery.
 * `deep=1` is readiness: it verifies configured external dependencies and all
 * database migrations, returning HTTP 503 when the instance must not receive
 * production traffic. `warm=1` additionally primes catalogue caches.
 */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const warm = query.get("warm") === "1";
  const deep = warm || query.get("deep") === "1";
  const startedAt = Date.now();
  const catalogProvider = storefrontCatalogProvider();

  if (!deep) {
    return NextResponse.json(
      {
        ok: true,
        live: true,
        // Readiness is deliberately not claimed by a shallow liveness probe.
        ready: null,
        degraded: false,
        scope: "liveness",
        app: "inkar-shop",
        catalogProvider,
        medusa: null,
        postgres: null,
        warmup: null,
        runtime: getMedusaRuntimeStats(),
        responseMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
      },
      { headers: NO_STORE },
    );
  }

  const warmed = warm
    ? await Promise.allSettled(catalogProvider === "daribar"
      ? [getDaribarProducts(100), getStorefrontNavigation()]
      : [getMedusaProducts(100), getCategoryTree()])
    : null;
  // Run the independent probes together, but only after warmup so we do not
  // add a third concurrent Medusa call while an already slow backend recovers.
  const [connection, postgres, daribarCatalog, typesense] = await Promise.all([
    catalogProvider === "daribar" ? Promise.resolve({ configured: false, reachable: false, stale: false }) : checkMedusaConnection(),
    inspectPostgresHealth(),
    catalogProvider === "daribar"
      ? readDaribarCatalogDatabase().then((snapshot) => ({ ready: true, runId: snapshot.runId,
        generatedAt: snapshot.generatedAt, count: snapshot.products.length })).catch(() => ({ ready: false }))
      : Promise.resolve({ ready: null }),
    catalogProvider === "daribar"
      ? getTypesenseIndexStatus().then((status) => ({ ready: true, generatedAt: status.metadata.generatedAt,
        count: status.metadata.documentCount, stale: status.stale })).catch(() => ({ ready: false }))
      : Promise.resolve({ ready: null }),
  ]);

  const postgresRequired = postgres.configured
    || String(process.env.CATALOG_READ_SOURCE || "").trim().toLowerCase() === "postgres";
  const medusaRequired = catalogProvider !== "daribar" && connection.configured;
  const readiness = dependencyReadiness({
    postgresRequired,
    postgresReady: postgres.ready,
    medusaRequired,
    medusaReachable: connection.reachable,
    medusaStale: connection.stale === true,
  });
  const daribarReady = catalogProvider !== "daribar" || (daribarCatalog.ready === true && typesense.ready === true);
  const ready = readiness.ready && daribarReady;
  const products = warmed?.[0]?.status === "fulfilled" ? warmed[0].value.length : null;
  const categories = warmed?.[1]?.status === "fulfilled" ? warmed[1].value.length : null;

  return NextResponse.json(
    {
      ok: ready,
      live: true,
      ready,
      degraded: readiness.degraded,
      scope: "readiness",
      app: "inkar-shop",
      catalogProvider,
      medusa: connection,
      postgres,
      dependencies: {
        medusa: { required: medusaRequired, ...connection },
        postgres: { required: postgresRequired, ...postgres },
        daribarCatalog: { required: catalogProvider === "daribar", ...daribarCatalog },
        typesense: { required: catalogProvider === "daribar", ...typesense },
      },
      warmup: warm ? { products, categories } : null,
      runtime: getMedusaRuntimeStats(),
      responseMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    },
    { status: ready ? 200 : 503, headers: NO_STORE },
  );
}
