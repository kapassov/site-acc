/** Only explicit Medusa Rx/OTC classifications are authoritative. */
export function medusaPrescription(value: unknown): boolean | undefined {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  return status === "rx" ? true : status === "otc" ? false : undefined;
}
