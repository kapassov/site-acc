/* eslint-disable @typescript-eslint/no-explicit-any */
import { secureMedusaBaseUrl } from "@/lib/medusaUrl";

const BASE = secureMedusaBaseUrl(process.env.MEDUSA_URL);
const PK = process.env.MEDUSA_PUBLISHABLE_KEY || "";

export const MEDUSA_REGION = process.env.MEDUSA_REGION || "reg_01KSBNEH2D4GVJN8EATK79WNSH";
export const MEDUSA_SALES_CHANNEL = process.env.MEDUSA_SALES_CHANNEL || "sc_01KRXGQFYXMJN3FD1WJ7S83WME";
export const MEDUSA_STORE_ON = Boolean(BASE && PK) && process.env.MEDUSA_ENABLED !== "false";

export class MedusaStoreError extends Error {
  status: number;
  data: any;

  constructor(status: number, data: any) {
    super(String(data?.message || data?.error || `Medusa Store API: ${status}`));
    this.status = status;
    this.data = data;
  }
}

export async function medusaStore<T = any>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null; query?: Record<string, string | number | boolean | undefined> } = {},
): Promise<T> {
  if (!MEDUSA_STORE_ON) throw new MedusaStoreError(503, { error: "medusa_off" });
  const url = new URL(path, `${BASE}/`);
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = { "x-publishable-api-key": PK };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) throw new MedusaStoreError(response.status, data);
    return data as T;
  } finally {
    clearTimeout(timeout);
  }
}
