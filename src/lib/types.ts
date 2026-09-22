export type ProductArtKind = "bottle" | "tube" | "jar" | "box" | "dropper" | "spray";

export interface ProductArt {
  kind: ProductArtKind;
  /** Base hue 0–360 used to tint the placeholder artwork. */
  hue: number;
}

export type ProductBadge = "sale" | "hit" | "new" | "rx";

export interface Brand {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  hue: number;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  /** lucide-react icon key, resolved in the UI layer. */
  icon: string;
  from: string;
  to: string;
  count: number;
}

export interface Product {
  id: string;
  /** Backend authority used for product, stock and checkout validation. */
  source?: "medusa" | "daribar";
  /** Stable supplier SKU. Required for Daribar checkout and image lookup. */
  sku?: string;
  /** Standard N identity, never interchangeable with a Daribar SKU. */
  wareId?: string;
  stockSourceDate?: string;
  stockValidUntil?: string;
  stockStale?: boolean;
  slug: string;
  name: string;
  /** Denormalized brand name from Medusa metadata. */
  brand: string;
  categorySlug: string;
  price: number;
  oldPrice?: number;
  /** Цена не задана в бэкенде — показываем «Цена уточняется». */
  priceTBD?: boolean;
  /** 0–5, one decimal. */
  rating: number;
  reviews: number;
  volume?: string;
  badges: ProductBadge[];
  art: ProductArt;
  /** Реальное изображение из Medusa (thumbnail/images), если есть. Иначе — арт-плейсхолдер. */
  image?: string;
  /** Все изображения товара (галерея) из Medusa. */
  images?: string[];
  /** Описание товара из Medusa, если есть. */
  description?: string;
  inStock: boolean;
  /** Сколько аптек сети держат товар в наличии (0 = нет в наличии). */
  stockPharmacies: number;
  prescription?: boolean;
  /** Все handle категорий товара из Medusa (включая родительские) — для фильтра по дереву. */
  categoryHandles?: string[];
  /** Вопрос-ответ из Medusa product.metadata.faq, если есть. */
  faq?: { q: string; a: string }[];
  /** Краткие характеристики из metadata.key_facts (массив пунктов). */
  keyFacts?: string[];
  /** Производитель (metadata.manufacturer_official / manufacturer). */
  manufacturer?: string;
  /** Страна производства (metadata.country_official / country). */
  country?: string;
  /** Действующее вещество / МНН (metadata.mnn). */
  mnn?: string;
  /** АТХ-классификация (metadata.atc / atc_1). */
  atc?: string;
  /** Штрихкод EAN (metadata.barcode). */
  barcode?: string;
  /** ID варианта Medusa, который обязателен для cart line-item. */
  variantId?: string;
  /** Реальные варианты Medusa, без угадывания фасовок по названию. */
  variants?: { id: string; title: string; sku?: string; barcode?: string; price?: number }[];
}

/** Узел реального дерева категорий Medusa (под корнем «Сайт»). */
export interface CatNode {
  id: string;
  name: string;
  handle: string;
  children: CatNode[];
}
