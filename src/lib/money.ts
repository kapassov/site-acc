/** KZT major units to integer tiyn; never silently round a real fractional tiyn. */
export function kztMinorUnits(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const minor = Math.round(value * 100);
  if (!Number.isSafeInteger(minor) || Math.abs(value - minor / 100) > 0.000001) return null;
  return minor;
}

export function exactKzt(value: unknown, fallback = 0): number {
  const amount = typeof value === "number" ? value : Number(value);
  const minor = kztMinorUnits(amount);
  return minor === null ? fallback : minor / 100;
}
