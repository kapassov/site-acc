import { createHmac } from "node:crypto";

const ACTOR_KEY = /^[a-f0-9]{64}$/;

export function daribarCustomerActorKey(
  phone: string,
  secret = process.env.CUSTOMER_AUTH_SECRET || "",
): string {
  const normalizedPhone = String(phone || "").replace(/\D/g, "");
  if (!/^7\d{10}$/.test(normalizedPhone)) {
    throw new Error("invalid_daribar_customer_phone");
  }
  if (secret.length < 32) {
    throw new Error("checkout_identity_secret_missing");
  }
  return createHmac("sha256", secret).update(normalizedPhone).digest("hex");
}

export function daribarCustomerIdFromActorKey(actorKey: string): string {
  if (!ACTOR_KEY.test(actorKey)) throw new Error("invalid_daribar_customer_actor");
  return `daribar:${actorKey}`;
}

export function daribarCustomerId(
  phone: string,
  secret = process.env.CUSTOMER_AUTH_SECRET || "",
): string {
  return daribarCustomerIdFromActorKey(daribarCustomerActorKey(phone, secret));
}
