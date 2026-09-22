const KNOWN_PLACEHOLDERS = new Set([
  "please-change-to-a-long-random-string",
  "change-me",
  "changeme",
]);

/** Runtime secrets fail closed when missing, short, or copied from examples. */
export function isStrongRuntimeSecret(value: string | null | undefined): value is string {
  const normalized = value?.trim() || "";
  return normalized.length >= 32 && !KNOWN_PLACEHOLDERS.has(normalized.toLowerCase());
}
