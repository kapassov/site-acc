import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const context = readFileSync("src/lib/auth/AuthContext.tsx", "utf8");
const modal = readFileSync("src/components/auth/AuthModal.tsx", "utf8");

test("auth context exposes only production SMS registration", () => {
  assert.match(context, /export type AuthMode = "loading" \| "sms";/);
  assert.doesNotMatch(context, /continueAsDemo/);
  assert.doesNotMatch(context, /action:\s*"demo"/);
  assert.match(context, /action:\s*"continue", phone: digits, code/);
  assert.match(context, /profileComplete === false/);
  assert.match(context, /userInfoFilled === false/);
  assert.match(context, /action:\s*"update"/);
});

test("registration modal is phone, OTP, then conditional profile", () => {
  assert.match(modal, /type Stage = "contact" \| "code" \| "profile"/);
  assert.match(modal, /continueWithPhone\(phone, code, \{ signal: controller\.signal \}\)/);
  assert.match(modal, /result\.needsProfile/);
  assert.match(modal, /updateProfile\(\{ name: cleanName \}, \{ signal: controller\.signal \}\)/);
  assert.doesNotMatch(modal, /Демо-режим|Продолжить в демо|1\s*500|приветственн.*балл/i);
});

test("OTP UI follows Daribar code and resend contracts", () => {
  assert.match(modal, /RESEND_DELAY_SECONDS = 30/);
  assert.match(modal, /isValidOtpCode\(code\)/);
  assert.match(modal, /maxLength=\{OTP_CODE_LENGTH\}/);
  assert.match(modal, /setError\(\{\s*key: "auth\.invalidOtp",\s*values: \{ count: OTP_CODE_LENGTH \}\s*\}\)/);
  assert.match(modal, /placeholder=\{t\("auth\.otpPlaceholder", \{ count: OTP_CODE_LENGTH \}\)\}/);
  assert.doesNotMatch(modal, /4[–-]6 цифр/);
  assert.match(modal, /autoComplete="one-time-code"/);
  assert.match(modal, /disabled=\{busy \|\| cooldown > 0\}/);
  assert.match(modal, /cooldown > 0 \? t\("auth\.resendIn", \{ seconds: cooldown \}\) : t\("auth\.resend"\)/);
});

test("OTP UI calls the server directly without the retired Turnstile flow", () => {
  assert.match(modal, /requestAuthJson\("\/api\/otp\/send"/);
  assert.match(modal, /phone: phoneDigits\(phone\)/);
  assert.doesNotMatch(modal, /Turnstile|turnstile|requestTurnstileToken/);
});

test("registration fields have mobile and accessibility attributes", () => {
  assert.match(modal, /htmlFor="auth-phone"/);
  assert.match(modal, /autoComplete="tel"/);
  assert.match(modal, /inputMode="numeric"/);
  assert.match(modal, /role="alert"/);
  assert.match(modal, /aria-describedby="auth-description"/);
});

test("stale OTP and session responses cannot overwrite a new flow", () => {
  assert.match(context, /revision !== sessionRevisionRef\.current/);
  assert.match(context, /return \(\) => controller\.abort\(\)/);
  assert.match(modal, /const result = await continueWithPhone[\s\S]*?if \(requestGeneration !== requestGenerationRef\.current\) return/);
  assert.match(modal, /const updateError = await updateProfile[\s\S]*?if \(requestGeneration !== requestGenerationRef\.current\) return/);
  assert.match(modal, /const changePhone = \(\) => \{[^}]*setBusy\(false\)/);
  assert.match(context, /const logout = useCallback\(\(\) => \{[\s\S]*?hydrationAbortRef\.current\?\.abort\(\);\s*setAuthMode\("sms"\)/);
  assert.match(context, /if \(pendingLogout && !await pendingLogout\)/);
  assert.match(context, /pendingLogoutRef\.current = pendingLogout/);
});

test("resend clears stale codes and respects provider cooldown", () => {
  assert.match(modal, /response\.ok && payload\?\.ok\) \{\s*setCode\(""\)/);
  assert.match(modal, /payload\?\.retryAfter \?\? response\.headers\.get\("retry-after"\)/);
  assert.match(modal, /stage === "contact" && cooldown > 0/);
  assert.match(modal, /value=\{phone\}\s+disabled=\{busy\}/);
  assert.match(modal, /value=\{code\}\s+disabled=\{busy\}/);
});

test("phone paste normalizes complete numbers without silently truncating invalid destinations", () => {
  assert.match(modal, /normalizeOtpPhone\(event\.clipboardData\.getData\("text"\)\)/);
  assert.match(modal, /event\.preventDefault\(\);\s*if \(!normalized\)/);
  assert.match(context, /const digits = normalizeOtpPhone\(contact\)/);
});

test("phone mask delegates caret-safe edits to the tested mask helper", () => {
  assert.match(modal, /applyPhoneMaskEdit\(/);
  assert.match(modal, /event\.target\.selectionStart/);
  assert.match(modal, /setSelectionRange\(edit\.caret, edit\.caret\)/);
});
