import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DaribarAuthContractError,
  parseDaribarAuthTokens,
  parseDaribarUserProfile,
  sendDaribarOtp,
  verifyDaribarOtp,
} from "../src/lib/daribar/auth.ts";
import { isValidOtpCode, OTP_CODE_LENGTH } from "../src/lib/otpContract.ts";

const sendRoute = readFileSync("src/app/api/otp/send/route.ts", "utf8");
const verifyRoute = readFileSync("src/app/api/otp/verify/route.ts", "utf8");
const authSource = readFileSync("src/lib/daribar/auth.ts", "utf8");

async function withEnv(patch, run) {
  const before = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(patch)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("Daribar auth and profile parsers reject partial or malformed upstream responses", () => {
  const tokens = parseDaribarAuthTokens({
    status: "success",
    result: {
      access_token: "access-token-that-is-long-enough.123",
      refresh_token: "refresh-token-that-is-long-enough.456",
    },
  });
  assert.equal(tokens.accessToken, "access-token-that-is-long-enough.123");
  for (const payload of [
    {},
    { status: "error", result: {} },
    { status: "success", result: { access_token: "short", refresh_token: "short" } },
    { status: "success", result: { access_token: "token with whitespace that is long", refresh_token: "refresh-token-that-is-long-enough" } },
  ]) {
    assert.throws(() => parseDaribarAuthTokens(payload), DaribarAuthContractError);
  }

  assert.deepEqual(parseDaribarUserProfile({
    status: "success",
    result: {
      phone: "77001234567",
      name: "Айдана",
      last_name: "Иманова",
      gender: "female",
      addresses: ["Алматы, Абая 10"],
      default_address: "Алматы, Абая 10",
      values: { network_code: "apteka_so_sklada" },
    },
  }), {
    phone: "77001234567",
    name: "Айдана",
    lastName: "Иманова",
    birthDate: null,
    gender: "female",
    addresses: ["Алматы, Абая 10"],
    defaultAddress: "Алматы, Абая 10",
    values: { network_code: "apteka_so_sklada" },
  });
  assert.throws(() => parseDaribarUserProfile({
    status: "success",
    result: { phone: "not-a-phone", addresses: [], values: {} },
  }), DaribarAuthContractError);
});

test("OTP send uses the public Swagger v2 endpoint without Turnstile", async () => {
  await withEnv({
    DARIBAR_ENABLED: "true",
    DARIBAR_OTP_ENABLED: "true",
    DARIBAR_API_URL: "https://backoffice.daribar.com",
    DARIBAR_AUTH_API_URL: "https://prod-backoffice.daribar.com",
  }, async () => {
    const originalFetch = globalThis.fetch;
    let request;
    globalThis.fetch = async (url, options) => {
      request = { url: String(url), options };
      return new Response(JSON.stringify({ status: "success" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    try {
      const result = await sendDaribarOtp("77001234567");
      assert.deepEqual(result, { userInfoFilled: false });
      assert.equal(request.url, "https://prod-backoffice.daribar.com/api/v2/sms");
      assert.equal(new Headers(request.options.headers).get("x-turnstile-token"), null);
      assert.deepEqual(JSON.parse(request.options.body), { phone: "77001234567", sms_type: "auth" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("OTP remains disabled when the Daribar OTP feature is disabled", async () => {
  await withEnv({
    DARIBAR_ENABLED: "true",
    DARIBAR_OTP_ENABLED: "false",
  }, async () => {
    await assert.rejects(
      () => sendDaribarOtp("77001234567"),
      (error) => error instanceof DaribarAuthContractError
        && error.code === "otp_transport_not_configured",
    );
  });
});

test("authorization accepts exactly four digits and rejects every other code shape", async () => {
  assert.equal(OTP_CODE_LENGTH, 4);
  assert.equal(isValidOtpCode("1234"), true);
  for (const code of ["123", "12345", "123456", "12x4", " 1234 ", 1234, null]) {
    assert.equal(isValidOtpCode(code), false);
  }

  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("invalid OTP codes must not reach Daribar");
  };
  try {
    for (const code of ["123", "12345", "123456", "12x4"]) {
      await assert.rejects(
        () => verifyDaribarOtp("77001234567", code),
        DaribarAuthContractError,
      );
    }
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("authorization forwards an exact four-digit code to Daribar", async () => {
  await withEnv({
    DARIBAR_API_URL: "https://backoffice.daribar.com",
    DARIBAR_AUTH_API_URL: "https://prod-backoffice.daribar.com",
  }, async () => {
    const originalFetch = globalThis.fetch;
    let request;
    globalThis.fetch = async (url, options) => {
      request = { url: String(url), options };
      return new Response(JSON.stringify({
        status: "success",
        result: {
          access_token: "access-token-that-is-long-enough.123",
          refresh_token: "refresh-token-that-is-long-enough.456",
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      await verifyDaribarOtp("77001234567", "1234");
      assert.equal(request.url, "https://prod-backoffice.daribar.com/api/v2/auth");
      assert.deepEqual(JSON.parse(request.options.body), {
        phone: "77001234567",
        validation_code: "1234",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("authorization uses the exact v2 Swagger request contract", () => {
  assert.match(authSource, /"\/api\/v2\/auth"/);
  assert.match(authSource, /body: \{ phone: normalizedPhone, validation_code: normalizedCode \}/);
});

test("Daribar-only OTP route has bounded input and no P1SMS or local-code fallback", () => {
  assert.match(sendRoute, /readBoundedJson<unknown>\(req, MAX_OTP_BODY_BYTES\)/);
  assert.match(sendRoute, /provider_unavailable.*503/s);
  assert.match(sendRoute, /await sendDaribarOtp\(phone\)/);
  assert.doesNotMatch(sendRoute, /userInfoFilled:\s*result|profileComplete:\s*result/);
  assert.doesNotMatch(sendRoute, /genCode|reserveCode|activateCode|discardCode|sendSms|P1SMS|customerAuthMode/);
  assert.doesNotMatch(sendRoute, /["']@\/lib\/otp(?:\.ts)?["']/);
  assert.match(verifyRoute, /status: 410/);
  assert.doesNotMatch(verifyRoute, /checkCode|@\/lib\/otp/);
});

test("profile lifecycle and token rotation use exact v1 Swagger paths", () => {
  assert.match(authSource, /"\/api\/v1\/auth\/refresh"/);
  assert.match(authSource, /"\/api\/v1\/users\/edit"/);
  assert.match(authSource, /method: "PUT"/);
  assert.match(authSource, /method: "DELETE"/);
  assert.match(authSource, /"\/api\/v1\/logout"/);
  assert.doesNotMatch(authSource, /\/api\/v2\/auth\/logout/);
  assert.match(authSource, /httpOnly: true/);
  assert.doesNotMatch(authSource, /NEXT_PUBLIC_DARIBAR/);
});
