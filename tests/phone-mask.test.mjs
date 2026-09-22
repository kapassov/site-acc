import assert from "node:assert/strict";
import test from "node:test";
import { applyPhoneMaskEdit, formatPhone } from "../src/lib/phone.ts";

test("phone mask formats Kazakhstan and Russian +7 numbers", () => {
  assert.equal(formatPhone("77064433452"), "+7 (706) 443-34-52");
  assert.equal(formatPhone("87064433452"), "+7 (706) 443-34-52");
});

test("backspace on a closing parenthesis removes the preceding digit", () => {
  const previous = "+7 (706) 443-34-52";
  const raw = "+7 (706 443-34-52";
  const edit = applyPhoneMaskEdit(previous, raw, "deleteContentBackward", 7);
  assert.equal(edit.value, "+7 (704) 433-45-2");
  assert.equal(edit.caret, 6);
});

test("backspace on the space after the area code also removes a digit", () => {
  const previous = "+7 (706) 443-34-52";
  const raw = "+7 (706)443-34-52";
  const edit = applyPhoneMaskEdit(previous, raw, "deleteContentBackward", 8);
  assert.equal(edit.value, "+7 (704) 433-45-2");
});

test("forward delete on mask punctuation removes the following local digit", () => {
  const previous = "+7 (706) 443-34-52";
  const raw = "+7 (706 443-34-52";
  const edit = applyPhoneMaskEdit(previous, raw, "deleteContentForward", 7);
  assert.equal(edit.value, "+7 (706) 433-45-2");
  assert.equal(edit.caret, 7);
});

test("select-all deletion clears the field and ordinary digit deletion stays predictable", () => {
  assert.deepEqual(
    applyPhoneMaskEdit("+7 (706) 443-34-52", "", "deleteContentBackward", 0),
    { value: "", caret: 0 },
  );
  assert.equal(
    applyPhoneMaskEdit("+7 (706) 443-34-52", "+7 (70) 443-34-52", "deleteContentBackward", 6).value,
    "+7 (704) 433-45-2",
  );
});
