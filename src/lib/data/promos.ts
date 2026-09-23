/**
 * Витринные промо-баннеры для сетки каталога.
 * Это маркетинговый CMS-слой, не товарные данные Medusa.
 */
export interface Promo {
  id: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  cta: string;
  href: string;
  img: string;
  position?: string;
  overlay?: string;
  className: string;
}

export const catalogPromos: Promo[] = [
  {
    id: "sale",
    eyebrow: "Акция недели",
    title: "Скидки до −40%",
    subtitle: "на витамины, БАДы и иммунитет",
    cta: "К акциям",
    href: "/catalog/bady",
    img: "/promo/banner-lifestyle-wellness.webp",
    position: "58% center",
    overlay: "from-[#42350f]/95 via-[#42350f]/68 to-[#42350f]/12",
    className: "bg-gradient-to-br from-accent-500 to-accent-600",
  },
  {
    id: "delivery",
    eyebrow: "Доставка",
    title: "Бесплатно за 30 минут",
    subtitle: "из 500 аптек сети по городу",
    cta: "Как это работает",
    href: "/delivery",
    img: "/promo/banner-lifestyle-family.webp",
    position: "62% center",
    overlay: "from-[#06483d]/95 via-[#06483d]/66 to-[#06483d]/10",
    className: "bg-gradient-to-br from-brand-600 to-brand-800",
  },
  {
    id: "bonus",
    eyebrow: "DARIHANA Club",
    title: "Кэшбэк до 10%",
    subtitle: "бонусами с каждой покупки",
    cta: "О программе",
    href: "/account",
    img: "/promo/banner-selfielab.webp",
    position: "58% center",
    overlay: "from-[#6b3d0d]/95 via-[#6b3d0d]/66 to-[#6b3d0d]/12",
    className: "bg-gradient-to-br from-gold-400 to-gold-600",
  },
];
