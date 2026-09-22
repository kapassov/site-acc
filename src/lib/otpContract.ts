export const OTP_CODE_LENGTH = 4;

/** Normalize a complete OTP destination without truncating or inventing digits. */
export function normalizeOtpPhone(value: unknown): string {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!/^\+?[\d\s().-]+$/.test(raw)) return "";
  let digits = raw.replace(/\D/g, "");
  // An explicit international prefix must already contain a full number.
  // Treating incomplete +7 input as a national number changes its recipient.
  if (raw.startsWith("+")) return /^7\d{10}$/.test(digits) ? digits : "";
  if (digits.length === 10) digits = `7${digits}`;
  else if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  return /^7\d{10}$/.test(digits) ? digits : "";
}

export function isValidOtpCode(value: unknown): value is string {
  return typeof value === "string"
    && value.length === OTP_CODE_LENGTH
    && /^\d+$/.test(value);
}
