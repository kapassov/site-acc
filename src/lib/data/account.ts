export type OrderStatus = "delivered" | "processing" | "cancelled" | "awaiting_payment" | "action_required";

export interface Order {
  id: string;
  detailId: string;
  providerOrderId?: string;
  date: string;
  status: OrderStatus;
  total: number;
  itemsCount: number;
  preview: string[];
  progressStep?: number;
  paymentStatus?: string;
  deliveryStatus?: string;
}

// Заказы приходят из бэка (Medusa). Демо-данных нет — пока реальных заказов нет, список пустой.
export const sampleOrders: Order[] = [];

export const orderStatusMeta: Record<OrderStatus, { label: string; className: string }> = {
  delivered: { label: "Доставлен", className: "bg-brand-50 text-brand-700" },
  processing: { label: "В обработке", className: "bg-amber-50 text-amber-700" },
  cancelled: { label: "Отменён", className: "bg-slate-100 text-slate-500" },
  awaiting_payment: { label: "Ожидает оплаты", className: "bg-sky-50 text-sky-700" },
  action_required: { label: "Требует внимания", className: "bg-rose-50 text-rose-700" },
};

export interface BonusEntry {
  date: string;
  label: string;
  amount: number;
}

// История бонусов приходит из бэка. Демо-операций нет; пустой список = операций пока нет.
export const bonusHistory: BonusEntry[] = [];

export const levels: { name: string; threshold: number; cashback: string }[] = [
  { name: "Bronze", threshold: 0, cashback: "3%" },
  { name: "Silver", threshold: 50000, cashback: "5%" },
  { name: "Gold", threshold: 150000, cashback: "7%" },
  { name: "Platinum", threshold: 400000, cashback: "10%" },
];
