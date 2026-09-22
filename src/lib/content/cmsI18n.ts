import type { Lang } from "@/lib/i18n/dict";

/**
 * Перевод ДЕФОЛТНОГО витринного контента по стабильным id (баннеры и подборки).
 * Контент, добавленный/изменённый в админке, остаётся на языке ввода — переводим только сид.
 */
const CMS_I18N: Partial<Record<Lang, Record<string, Record<string, string>>>> = {
  kz: {
    b1: { eyebrow: "Жазғы жеңілдік", title: "Жеңілдік −40%-ке дейін", sub: "Күтім, витаминдер және косметика", cta: "Топтаманы көру" },
    b2: { eyebrow: "Иммунитет маусымы", title: "Витаминдер −25%", sub: "D3, Omega-3, магний және мырыш", cta: "Курс таңдау" },
    b3: { eyebrow: "30 минутта жеткізу", title: "5 000 ₸-ден тегін", sub: "Қала бойынша курьер", cta: "Каталогқа" },
    b4: { eyebrow: "Медициналық құрылғылар", title: "Денсаулық\nбақылауда", sub: "Тонометрлер, термометрлер, глюкометрлер және ингаляторлар", cta: "Құрылғы таңдау" },
    b5: { eyebrow: "Үйге арналған", title: "Артық затсыз\nүй дәрі қобдишасы", sub: "Алғашқы көмек және күнделікті қажетті тауарлар", cta: "Дәрі қобдишасын жинау" },
    b6: { eyebrow: "Витаминдер мен баланс", title: "Күн сайын\nқозғалыста", sub: "Витаминдер мен минералдар бір бөлімде", cta: "Витаминдерді таңдау" },
    b7: { eyebrow: "Ана мен бала", title: "Алғашқы күннен\nмейірімді қамқорлық", sub: "Аналар мен сәбилерге арналған тауарлар", cta: "Тауарларды көру" },
    c1: { title: "Иммунитет және қуат" },
    c2: { title: "Ұйқы және антистресс" },
    c3: { title: "Тері жарқырауы" },
    c4: { title: "Терең ылғалдандыру" },
    c5: { title: "Күннен қорғау" },
    c6: { title: "Аллергия маусымы" },
    c7: { title: "Ана мен бала" },
    ql1: { label: "Сұлулық" }, ql2: { label: "Дәріханадан да көп" }, ql3: { label: "Витаминдер" }, ql4: { label: "Ана мен бала" },
  },
  en: {
    b1: { eyebrow: "Summer sale", title: "Up to −40% off", sub: "On skincare, vitamins and cosmetics", cta: "View collection" },
    b2: { eyebrow: "Immunity season", title: "Vitamins −25%", sub: "D3, Omega-3, magnesium and zinc", cta: "Pick a course" },
    b3: { eyebrow: "30-minute delivery", title: "Free from 5,000 ₸", sub: "Courier across the city", cta: "To catalog" },
    b4: { eyebrow: "Medical devices", title: "Health\nunder control", sub: "Blood pressure monitors, thermometers, glucometers and inhalers", cta: "Choose a device" },
    b5: { eyebrow: "For the home", title: "A smarter\nhome first-aid kit", sub: "First aid and everyday essentials", cta: "Build a first-aid kit" },
    b6: { eyebrow: "Vitamins & balance", title: "Keep moving\nevery day", sub: "Vitamins and minerals in one place", cta: "Choose vitamins" },
    b7: { eyebrow: "Mom & baby", title: "Gentle care\nfrom the first days", sub: "Essentials for moms and babies", cta: "View products" },
    c1: { title: "Immunity & energy" },
    c2: { title: "Sleep & anti-stress" },
    c3: { title: "Skin glow" },
    c4: { title: "Deep hydration" },
    c5: { title: "Sun protection" },
    c6: { title: "Allergy season" },
    c7: { title: "Mom & baby" },
    ql1: { label: "Beauty" }, ql2: { label: "More than a pharmacy" }, ql3: { label: "Vitamins" }, ql4: { label: "Mom & baby" },
  },
};

export function cmsTr(lang: Lang, id: string, field: string, fallback: string): string {
  if (lang === "ru") return fallback;
  return CMS_I18N[lang]?.[id]?.[field] ?? fallback;
}
