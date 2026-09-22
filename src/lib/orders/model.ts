/** File storage is a local-development fallback only, never a database outage fallback. */
export function ordersStorageMode(databaseUrlValue?: string, postgresUrlValue?: string): "postgres" | "file" {
  return String(databaseUrlValue || postgresUrlValue || "").trim() ? "postgres" : "file";
}

export function orderCreatedOutboxKey(orderId: string): string {
  return `epharm:site_order:${orderId}:created:v1`;
}

export function orderStatusOutboxKey(orderId: string, statusVersion: number): string {
  return `epharm:site_order:${orderId}:status:v${statusVersion}`;
}
