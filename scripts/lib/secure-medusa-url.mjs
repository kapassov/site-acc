const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LEGACY_HTTP_ORIGIN = "http://78.140.246.238:9000";

export function secureMedusaUrl(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) throw new Error("MEDUSA_URL is required");

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("MEDUSA_URL must be an absolute URL");
  }
  if (url.username || url.password) {
    throw new Error("Do not embed credentials in MEDUSA_URL");
  }
  const loopbackHttp = url.protocol === "http:"
    && LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  const legacyHttp = url.protocol === "http:"
    && process.env.MEDUSA_ALLOW_INSECURE_LEGACY_HTTP === "true"
    && url.origin === LEGACY_HTTP_ORIGIN
    && url.pathname === "/";
  if (url.protocol !== "https:" && !loopbackHttp && !legacyHttp) {
    throw new Error("MEDUSA_URL must use HTTPS; HTTP requires loopback or the explicit legacy origin opt-in");
  }
  if (url.search || url.hash) {
    throw new Error("MEDUSA_URL must not contain a query string or fragment");
  }

  return url;
}
