export type PushOrderIdentity = {
  id: string;
  sourceOrderId: string;
  displayNumber: number;
  customerId?: string;
};

/** A device may follow only orders owned by its current authenticated customer. */
export function canBindOrder(
  order: PushOrderIdentity | undefined,
  orderReference: string,
  deviceCustomerId: string | undefined,
  sessionCustomerId: string,
): boolean {
  const reference = orderReference.trim();
  if (!order || !reference || !sessionCustomerId) return false;
  if (!deviceCustomerId || deviceCustomerId !== sessionCustomerId) return false;
  if (!order.customerId || order.customerId !== sessionCustomerId) return false;
  return reference === order.id
    || reference === order.sourceOrderId
    || reference === String(order.displayNumber);
}

export function customerChanged(previousCustomerId: string | undefined, nextCustomerId: string): boolean {
  return previousCustomerId !== nextCustomerId;
}
