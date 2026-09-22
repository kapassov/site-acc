// Маска и нормализация номера РК/РФ: +7 (7XX) XXX-XX-XX.
// phoneDigits — 11 цифр 7XXXXXXXXXX (ключ аккаунта, тело запроса в P1SMS).
// formatPhone — то, что видит пользователь. Зеркалит Flutter _PhoneFormatter.

export function phoneDigits(raw: string): string {
  let d = (raw || "").replace(/\D/g, "");
  if (d.startsWith("8")) d = "7" + d.slice(1);
  if (d && !d.startsWith("7")) d = "7" + d;
  return d.slice(0, 11);
}

export function formatPhone(raw: string): string {
  const d = phoneDigits(raw);
  if (!d) return "";
  let s = "+7";
  if (d.length > 1) s += " (" + d.slice(1, Math.min(4, d.length));
  if (d.length >= 4) s += ")";
  if (d.length > 4) s += " " + d.slice(4, Math.min(7, d.length));
  if (d.length > 7) s += "-" + d.slice(7, Math.min(9, d.length));
  if (d.length > 9) s += "-" + d.slice(9, 11);
  return s;
}

export type PhoneMaskEdit = {
  value: string;
  caret: number;
};

function digitCount(value: string): number {
  return (value.match(/\d/g) || []).length;
}

function caretAfterDigits(value: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (/\d/.test(value[index])) seen += 1;
    if (seen === count) return index + 1;
  }
  return value.length;
}

/**
 * Apply the +7 mask without trapping Backspace/Delete on punctuation.
 * Mobile browsers report separator deletion through `inputType`; when no
 * digit changed, we remove the adjacent local-number digit instead.
 */
export function applyPhoneMaskEdit(
  previousValue: string,
  rawValue: string,
  inputType = "",
  selectionStart = rawValue.length,
): PhoneMaskEdit {
  const previousDigits = phoneDigits(previousValue);
  let nextDigits = phoneDigits(rawValue);
  const caret = Math.max(0, Math.min(rawValue.length, selectionStart));
  const digitsBeforeCaret = digitCount(rawValue.slice(0, caret));
  let desiredDigitsBeforeCaret = digitsBeforeCaret;

  const deletedOnlyMaskCharacter = rawValue.length < previousValue.length
    && nextDigits === previousDigits
    && /^deleteContent(?:Backward|Forward)$/.test(inputType);

  if (deletedOnlyMaskCharacter && previousDigits.length > 1) {
    const backwards = inputType === "deleteContentBackward";
    const targetIndex = backwards ? digitsBeforeCaret - 1 : digitsBeforeCaret;
    // Index 0 is the immutable country code while local digits are present.
    if (targetIndex >= 1 && targetIndex < previousDigits.length) {
      nextDigits = previousDigits.slice(0, targetIndex) + previousDigits.slice(targetIndex + 1);
      desiredDigitsBeforeCaret = backwards
        ? Math.max(1, digitsBeforeCaret - 1)
        : Math.max(1, digitsBeforeCaret);
    }
  }

  const value = formatPhone(nextDigits);
  return {
    value,
    caret: caretAfterDigits(value, Math.min(desiredDigitsBeforeCaret, digitCount(value))),
  };
}

export const isFullPhone = (raw: string): boolean => phoneDigits(raw).length === 11;
