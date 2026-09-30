import assert from "node:assert/strict";
import test from "node:test";

import {
  daribarImageUrl,
  declaredImageMime,
  detectDaribarImageMime,
  isGenericBinaryMime,
} from "../src/lib/daribar/images.ts";

test("Daribar image URLs stay pinned to the optimized image origin", () => {
  const original = process.env.DARIBAR_IMAGE_URL;
  delete process.env.DARIBAR_IMAGE_URL;
  try {
    assert.equal(
      daribarImageUrl("12345-A").href,
      "https://db-images.object.pscloud.io/optimized_v4_img_small_12345-A.webp",
    );
    assert.throws(() => daribarImageUrl("../../admin"), /invalid_daribar_sku/);
  } finally {
    if (original === undefined) delete process.env.DARIBAR_IMAGE_URL;
    else process.env.DARIBAR_IMAGE_URL = original;
  }
});

test("Daribar image validation requires matching MIME and file signatures", () => {
  const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(detectDaribarImageMime(webp), "image/webp");
  assert.equal(detectDaribarImageMime(jpeg), "image/jpeg");
  assert.equal(detectDaribarImageMime(png), "image/png");
  assert.equal(detectDaribarImageMime(new TextEncoder().encode("<html>")), null);
  assert.equal(isGenericBinaryMime("binary/octet-stream"), true);
  assert.equal(isGenericBinaryMime("application/octet-stream"), true);
  assert.equal(isGenericBinaryMime("text/html"), false);
  assert.equal(declaredImageMime("image/webp; charset=binary"), "image/webp");
  assert.equal(declaredImageMime("text/html"), null);
});
