const MEDUSA_BASE = (process.env.MEDUSA_URL || "http://78.140.246.238:9000").replace(/\/$/, "");
// Persisted Medusa assets retain this public origin when API traffic moves to
// the private loopback tunnel. Only their /static path is sent to our proxy.
const LEGACY_MEDUSA_MEDIA_ORIGIN = "http://78.140.246.238:9000";

/** Convert Medusa HTTP /static links to the storefront HTTPS media endpoint. */
export function medusaMediaUrl(raw: unknown): string | undefined {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return undefined;
  if (value.startsWith("/api/media/medusa?")) return value;

  try {
    const source = new URL(value, MEDUSA_BASE);
    const backend = new URL(MEDUSA_BASE);
    if ((source.origin === backend.origin || source.origin === LEGACY_MEDUSA_MEDIA_ORIGIN)
        && source.pathname.startsWith("/static/")) {
      return `/api/media/medusa?path=${encodeURIComponent(source.pathname + source.search)}`;
    }
  } catch {
    return value;
  }
  return value;
}
