import assert from "node:assert/strict";
import test from "node:test";

import { deliveryDetailsComment, normalizeDeliveryDetails } from "../src/lib/checkout/delivery-details.ts";

test("normalizes structured courier details and composes a bounded provider comment", () => {
  const details = normalizeDeliveryDetails({
    placeType: "apartment",
    unit: " 24 ",
    entrance: "2",
    floor: "7",
    intercom: "24#",
    instructions: "  Вход со двора\nрядом с аркой  ",
    leaveAtDoor: true,
  });

  assert.deepEqual(details, {
    placeType: "apartment",
    unit: "24",
    entrance: "2",
    floor: "7",
    intercom: "24#",
    instructions: "Вход со двора рядом с аркой",
    leaveAtDoor: true,
  });
  const comment = deliveryDetailsComment(details);
  assert.match(comment, /Квартира: 24/);
  assert.match(comment, /оставить у двери/);
  assert.ok(comment.length <= 500);
});

test("rejects malformed courier details and keeps a safe fallback comment", () => {
  assert.equal(normalizeDeliveryDetails({ placeType: "garage", leaveAtDoor: false }), null);
  assert.equal(deliveryDetailsComment(null, "  Позвонить\nзаранее "), "Позвонить заранее");
});
