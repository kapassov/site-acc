export type CheckoutDelivery = "courier" | "pickup" | "post";

export type CheckoutField = "name" | "phone" | "city" | "address" | "pharmacy";

export type CheckoutFieldErrors = Partial<Record<CheckoutField, string>>;

export type CheckoutValidationInput = {
  name: string;
  phone: string;
  city: string;
  address: string;
  delivery: CheckoutDelivery;
  pickupAvailable: boolean;
};

export function validateCheckoutFields(input: CheckoutValidationInput): CheckoutFieldErrors {
  const errors: CheckoutFieldErrors = {};
  const phoneDigits = input.phone.replace(/\D/g, "");

  if (!input.name.trim()) errors.name = "Укажите имя получателя";
  if (phoneDigits.length < 11) errors.phone = "Введите номер телефона полностью";
  if (!input.city.trim()) errors.city = "Укажите город";

  if (input.delivery === "pickup") {
    if (!input.pickupAvailable) errors.pharmacy = "Выберите доступную аптеку";
  } else {
    const address = input.address.trim();
    if (!address) errors.address = "Укажите адрес доставки";
    else if (!/\d/.test(address)) errors.address = "Добавьте номер дома";
  }

  return errors;
}

export function firstCheckoutFieldError(errors: CheckoutFieldErrors): CheckoutField | null {
  const priority: CheckoutField[] = ["name", "phone", "city", "address", "pharmacy"];
  return priority.find((field) => Boolean(errors[field])) ?? null;
}
