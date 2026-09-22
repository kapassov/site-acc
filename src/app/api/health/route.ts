import { NextResponse } from "next/server";
import { inspectPostgresHealth } from "@/lib/database-health";
import { dependencyReadiness } from "@/lib/health-readiness";
import {
  checkMedusaConnection,
  getCategoryTree,
  getMedusaProducts,
  getMedusaRuntimeStats,
} from "@/lib/medusa";

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
    ? await Promise.allSettled([getMedusaProducts(100), getCategoryTree()])
    : null;
  // Run the independent probes together, but only after warmup so we do not
  // add a third concurrent Medusa call while an already slow backend recovers.
  const [connection, postgres] = await Promise.all([
    checkMedusaConnection(),
    inspectPostgresHealth(),
  ]);

  const postgresRequired = postgres.configured
    || String(process.env.CATALOG_READ_SOURCE || "").trim().toLowerCase() === "postgres";
  const medusaRequired = connection.configured;
  const readiness = dependencyReadiness({
    postgresRequired,
    postgresReady: postgres.ready,
    medusaRequired,
    medusaReachable: connection.reachable,
    medusaStale: connection.stale === true,
  });
  const ready = readiness.ready;
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
      medusa: connection,
      postgres,
      dependencies: {
        medusa: { required: medusaRequired, ...connection },
        postgres: { required: postgresRequired, ...postgres },
      },
      warmup: warm ? { products, categories } : null,
      runtime: getMedusaRuntimeStats(),
      responseMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    },
    { status: ready ? 200 : 503, headers: NO_STORE },
  );
}
