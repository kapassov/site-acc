import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("checkout receipt QR is generated locally without disclosing identifiers", async () => {
  const checkout = await readFile(
    new URL("../src/app/checkout/page.tsx", import.meta.url),
    "utf8",
  );
  const qrComponent = await readFile(
    new URL("../src/components/checkout/LocalQrCode.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(checkout, /api\.qrserver\.com|create-qr-code/);
  assert.match(checkout, /<LocalQrCode/);
  assert.match(qrComponent, /QRCode\.toDataURL/);
  assert.doesNotMatch(qrComponent, /fetch\s*\(|https?:\/\//);
});
