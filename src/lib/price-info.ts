export type PharmaPrice = {
  id: string;
  name: string;
  city: string;
  price: number;
  address?: string;
  quantity?: number;
  availableQuantity?: number;
  inStock?: boolean;
  sourceDate?: string;
  snapshotId?: string;
  variantId?: string;
  wareId?: string;
  lat?: number;
  lon?: number;
  hours?: string;
};

export type PriceInfo = {
  min: number | null;
  max: number | null;
  count: number;
  pharmacies: PharmaPrice[];
  source?: "medusa";
  complete?: boolean;
  stale?: boolean;
  sourceDate?: string;
  snapshotId?: string;
  validUntil?: string;
};
