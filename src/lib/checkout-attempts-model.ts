export type CheckoutAttemptState = "pending" | "uncertain" | "replay";

export type CheckoutAttemptIdentity = {
  idempotencyKey: string;
  actorKey: string;
  cartInstanceKey: string;
  cartHash: string;
  requestHash: string;
};

export type CheckoutAttemptSnapshot = CheckoutAttemptIdentity & {
  state: CheckoutAttemptState;
  leaseExpiresAt: number;
  providerStarted: boolean;
};

export type CheckoutAttemptDecision =
  | "conflict"
  | "pending"
  | "resume"
  | "mark_uncertain"
  | "uncertain"
  | "replay";

/** File persistence is deliberately limited to single-process development. */
export function checkoutAttemptStorageMode(
  databaseUrlValue: string | undefined,
  postgresUrlValue: string | undefined,
  nodeEnvValue: string | undefined,
): "postgres" | "file" {
  if (String(databaseUrlValue || postgresUrlValue || "").trim()) return "postgres";
  if (String(nodeEnvValue || "").trim().toLowerCase() === "production") {
    throw new Error("checkout_attempts_database_required");
  }
  return "file";
}

/**
 * An expired lease is safe to resume only if the provider POST was never
 * marked as started. Once that boundary was crossed, recovery is fail-closed.
 */
export function checkoutAttemptDecision(
  row: CheckoutAttemptSnapshot,
  input: CheckoutAttemptIdentity,
  now: number,
): CheckoutAttemptDecision {
  if (row.actorKey !== input.actorKey) return "conflict";
  const sameIdempotency = row.idempotencyKey === input.idempotencyKey;
  const sameCartInstance = row.cartInstanceKey === input.cartInstanceKey;
  if (!sameIdempotency && !sameCartInstance) return "conflict";
  if (row.cartInstanceKey !== input.cartInstanceKey
      || row.cartHash !== input.cartHash
      || row.requestHash !== input.requestHash) {
    return "conflict";
  }
  if (row.state === "replay") return "replay";
  if (row.state === "uncertain") return "uncertain";
  if (row.leaseExpiresAt > now) return "pending";
  return row.providerStarted ? "mark_uncertain" : "resume";
}
