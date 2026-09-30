import { createHash } from "node:crypto";

/** Stable, valid v4 UUIDs for Daribar-specific tests. */
export function daribarUuid(label) {
  const hex = createHash("sha256").update(String(label)).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
