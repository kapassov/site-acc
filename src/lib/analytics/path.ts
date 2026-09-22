const PAYMENT_PATH = "/payment";
const REDACTED_PAYMENT_PATH = "/payment/[session]";

/**
 * Payment-session ids are opaque, owner-bound identifiers, but they still do
 * not belong in analytics payloads. Keep the route useful for reporting while
 * removing every dynamic payment-path segment before an event is created.
 */
export function analyticsPath(pathname: unknown): string {
  if (typeof pathname !== "string") return "";
  const normalized = pathname.toLowerCase();
  return normalized === PAYMENT_PATH || normalized.startsWith(`${PAYMENT_PATH}/`)
    ? REDACTED_PAYMENT_PATH
    : pathname;
}
