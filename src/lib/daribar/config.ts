const DARIBAR_HOSTS = new Set([
  "backoffice.daribar.com",
  "prod-backoffice.daribar.com",
]);

const DARIBAR_IMAGE_HOSTS = new Set([
  "db-images.object.pscloud.io",
]);

export type DaribarFeature = "catalog" | "images" | "otp" | "order" | "pharmacies" | "delivery";

export class DaribarConfigError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "DaribarConfigError";
  }
}

function enabled(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function disabled(value: string | undefined): boolean {
  return /^(0|false|no|off)$/i.test(String(value || "").trim());
}

function exactHttpsOrigin(raw: string, allowedHosts: Set<string>, code: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DaribarConfigError(code);
  }
  if (url.protocol !== "https:"
      || !allowedHosts.has(url.hostname.toLowerCase())
      || url.username
      || url.password
      || (url.pathname !== "/" && url.pathname !== "")
      || url.search
      || url.hash) {
    throw new DaribarConfigError(code);
  }
  return url;
}

export function isDaribarEnabled(feature?: DaribarFeature): boolean {
  if (!enabled(process.env.DARIBAR_ENABLED)) return false;
  if (!feature) return true;
  const specific = process.env[`DARIBAR_${feature.toUpperCase()}_ENABLED`];
  return specific == null || specific === "" ? true : !disabled(specific);
}

export function isDaribarDeliveryEnabled(): boolean {
  return isDaribarEnabled() && /^(1|true|yes|on)$/i.test(String(process.env.DARIBAR_DELIVERY_ENABLED || ""));
}

export function daribarApiOrigin(): URL {
  return exactHttpsOrigin(
    String(process.env.DARIBAR_API_URL || "https://backoffice.daribar.com/"),
    DARIBAR_HOSTS,
    "invalid_daribar_api_url",
  );
}

/**
 * Authentication is intentionally isolated from the catalogue origin.
 * Daribar's storefront uses the production backoffice for real customer SMS,
 * while the supplied integration catalogue may still point at the stage host.
 */
export function daribarAuthApiOrigin(): URL {
  return exactHttpsOrigin(
    String(process.env.DARIBAR_AUTH_API_URL || "https://prod-backoffice.daribar.com/"),
    DARIBAR_HOSTS,
    "invalid_daribar_auth_api_url",
  );
}

/** Delivery pricing, order creation and hosted payment must share one Daribar environment. */
export function daribarCommerceApiOrigin(): URL {
  return exactHttpsOrigin(
    String(process.env.DARIBAR_COMMERCE_API_URL || process.env.DARIBAR_AUTH_API_URL
      || "https://prod-backoffice.daribar.com/"),
    DARIBAR_HOSTS,
    "invalid_daribar_commerce_api_url",
  );
}

/** Order creation can be routed independently from delivery pricing. */
export function daribarOrderApiOrigin(): URL {
  return exactHttpsOrigin(
    String(process.env.DARIBAR_ORDER_API_URL || process.env.DARIBAR_COMMERCE_API_URL
      || process.env.DARIBAR_AUTH_API_URL || "https://prod-backoffice.daribar.com/"),
    DARIBAR_HOSTS,
    "invalid_daribar_order_api_url",
  );
}

export function daribarImageOrigin(): URL {
  return exactHttpsOrigin(
    String(process.env.DARIBAR_IMAGE_URL || "https://db-images.object.pscloud.io/"),
    DARIBAR_IMAGE_HOSTS,
    "invalid_daribar_image_url",
  );
}

export function daribarServiceToken(): string {
  return String(process.env.DARIBAR_SERVICE_TOKEN || process.env.DARIBAR_TOKEN || "").trim();
}

/**
 * Optional production partner credential supplied by Daribar. It is kept
 * separate from the stage service token so a catalogue credential can never
 * accidentally be presented as a commerce partner credential.
 */
export function daribarPartnerToken(): string {
  const token = String(process.env.DARIBAR_PARTNER_TOKEN || "").trim();
  if (!token) return "";
  if (token.length < 20 || token.length > 8_192 || /\s/.test(token)) {
    throw new DaribarConfigError("invalid_daribar_partner_token");
  }
  return token;
}

export function daribarNetworkCode(): string {
  return String(process.env.DARIBAR_NETWORK_CODE || "apteka_so_sklada").trim().slice(0, 100);
}

/**
 * Public v3 search accepts this B2B code without a bearer token. Daribar uses
 * the same configured ASS code for the current production integration, while
 * a dedicated value can be supplied later without changing the network code
 * used by the legacy order parser.
 */
export function daribarIntegrationCode(): string {
  const code = String(process.env.DARIBAR_INTEGRATION_CODE || daribarNetworkCode()).trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(code)) {
    throw new DaribarConfigError("invalid_daribar_integration_code");
  }
  return code;
}

export function daribarDefaultCity(): string {
  return String(process.env.DARIBAR_DEFAULT_CITY || "Алматы").trim().slice(0, 100) || "Алматы";
}

/**
 * Daribar's fast priced catalogue currently returns zero in total_count.
 * Operations can seed the verified city/network total without making every
 * catalogue request wait for the much slower global category aggregation.
 */
export function daribarCatalogTotalHint(): number {
  const value = Number(process.env.DARIBAR_CATALOG_TOTAL || 0);
  return Number.isFinite(value) && value > 0
    ? Math.min(1_000_000, Math.trunc(value))
    : 0;
}
