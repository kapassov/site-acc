export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { prewarmMedusaTitleIndex } = await import("@/lib/medusa-catalog");
    await prewarmMedusaTitleIndex();
  } catch (error) {
    // Startup remains available when PostgreSQL is temporarily unavailable;
    // the normal fail-closed catalogue path will retry and expose no stale stock.
    console.error("[search] title index prewarm failed", error instanceof Error ? error.message : "prewarm_failed");
  }
}
