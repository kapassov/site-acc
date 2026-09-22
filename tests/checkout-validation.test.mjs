import assert from "node:assert/strict";
import test from "node:test";

import { firstCheckoutFieldError, validateCheckoutFields } from "../src/lib/checkoutValidation.ts";

test("courier checkout highlights every required empty field", () => {
  const errors = validateCheckoutFields({
    name: "",
    phone: "+7",
    city: "",
    address: "",
    delivery: "courier",
    pickupAvailable: false,
  });

  assert.deepEqual(errors, {
    name: "Укажите имя получателя",
    phone: "Введите номер телефона полностью",
    city: "Укажите город",
    address: "Укажите адрес доставки",
  });
  assert.equal(firstCheckoutFieldError(errors), "name");
});

test("courier address requires a house number", () => {
  const errors = validateCheckoutFields({
    name: "Айдана",
    phone: "+7 (700) 123-45-67",
    city: "Алматы",
    address: "пр. Абая",
    delivery: "courier",
    pickupAvailable: false,
  });

  assert.equal(errors.address, "Добавьте номер дома");
});

test("pickup requires an available pharmacy but not a street address", () => {
  const invalid = validateCheckoutFields({
    name: "Айдана",
    phone: "+7 (700) 123-45-67",
    city: "Алматы",
    address: "",
    delivery: "pickup",
    pickupAvailable: false,
  });
  const valid = validateCheckoutFields({
    name: "Айдана",
    phone: "+7 (700) 123-45-67",
    city: "Алматы",
    address: "",
    delivery: "pickup",
    pickupAvailable: true,
  });

  assert.deepEqual(invalid, { pharmacy: "Выберите доступную аптеку" });
  assert.deepEqual(valid, {});
});
