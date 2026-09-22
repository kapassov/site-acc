"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { useCatalogData } from "@/lib/content/CatalogData";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { SectionHeader } from "./SectionHeader";
import { useLang } from "@/lib/i18n/LanguageContext";
import { catalogCategoryName } from "@/lib/i18n/catalog-categories";

const categoryVisuals: Record<string, { img: string; position: string; overlay: string }> = {
  bady: { img: "/promo/quick-vitamins-unique.webp", position: "58% center", overlay: "from-[#4a4315]/95 via-[#4a4315]/58 to-transparent" },
  kosmetika: { img: "/promo/quick-beauty-unique.webp", position: "58% center", overlay: "from-[#123c2b]/95 via-[#123c2b]/58 to-transparent" },
  "lekarstva-i-bady": { img: "/promo/care-allergy.webp", position: "66% center", overlay: "from-[#07534f]/95 via-[#07534f]/62 to-transparent" },
  gigiyena: { img: "/promo/care-sleep.webp", position: "68% center", overlay: "from-[#17425d]/95 via-[#17425d]/64 to-transparent" },
  "mama-i-malysh": { img: "/promo/quick-family-unique.webp", position: "62% center", overlay: "from-[#493064]/95 via-[#493064]/60 to-transparent" },
  "med-pribory-i-izdeliya": { img: "/promo/category-medical-products.webp", position: "70% center", overlay: "from-[#104d43]/95 via-[#104d43]/62 to-transparent" },
  "sport-i-fitnes": { img: "/promo/banner-lifestyle-wellness.webp", position: "58% center", overlay: "from-[#0d3c32]/95 via-[#0d3c32]/56 to-transparent" },
  linzy: { img: "/promo/banner-ivatherm.webp", position: "58% center", overlay: "from-[#57172e]/95 via-[#57172e]/58 to-transparent" },
  "tovary-dlya-vzroslyh": { img: "/promo/banner-lifestyle-family.webp", position: "58% center", overlay: "from-[#102958]/95 via-[#102958]/58 to-transparent" },
  "zagar-i-zashita-ot-solnca": { img: "/promo/care-sun.webp", position: "70% center", overlay: "from-[#824108]/95 via-[#824108]/58 to-transparent" },
  "face-care": { img: "/promo/care-skin.webp", position: "68% center", overlay: "from-[#681f2d]/95 via-[#681f2d]/65 to-transparent" },
  "body-care": { img: "/promo/care-hydration.webp", position: "70% center", overlay: "from-[#07516a]/95 via-[#07516a]/60 to-transparent" },
  "mom-baby": { img: "/promo/care-mom-baby.webp", position: "68% center", overlay: "from-[#493064]/95 via-[#493064]/60 to-transparent" },
  vitamins: { img: "/promo/care-energy.webp", position: "64% center", overlay: "from-[#4a4315]/95 via-[#4a4315]/60 to-transparent" },
  medicines: { img: "/promo/care-allergy.webp", position: "67% center", overlay: "from-[#07534f]/95 via-[#07534f]/62 to-transparent" },
  hygiene: { img: "/promo/care-sleep.webp", position: "68% center", overlay: "from-[#17425d]/95 via-[#17425d]/64 to-transparent" },
  sun: { img: "/promo/care-sun.webp", position: "70% center", overlay: "from-[#824108]/95 via-[#824108]/58 to-transparent" },
  makeup: { img: "/promo/banner-lifestyle-skincare.webp", position: "64% center", overlay: "from-[#541b55]/95 via-[#541b55]/62 to-transparent" },
  "medical-products": { img: "/promo/category-medical-products.webp", position: "70% center", overlay: "from-[#104d43]/95 via-[#104d43]/62 to-transparent" },
};

function visualForCategory(cat: { slug: string; name: string }) {
  const direct = categoryVisuals[cat.slug];
  if (direct) return direct;

  const name = cat.name.toLowerCase();
  if (name.includes("бад") || name.includes("витамин")) return categoryVisuals.bady;
  if (name.includes("космет") || name.includes("красот")) return categoryVisuals.kosmetika;
  if (name.includes("лекар")) return categoryVisuals["lekarstva-i-bady"];
  if (name.includes("гиги")) return categoryVisuals.gigiyena;
  if (name.includes("мама") || name.includes("малыш") || name.includes("дет")) return categoryVisuals["mama-i-malysh"];
  if (name.includes("мед")) return categoryVisuals["med-pribory-i-izdeliya"];
  if (name.includes("спорт")) return categoryVisuals["sport-i-fitnes"];
  if (name.includes("линз")) return categoryVisuals.linzy;
  if (name.includes("солн") || name.includes("загар")) return categoryVisuals["zagar-i-zashita-ot-solnca"];

  return categoryVisuals.kosmetika;
}

export function CategoryGrid() {
  const { t, plural, lang } = useLang();
  const { categories: live } = useCatalogData();
  const cats = live.slice(0, 8);
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6">
      <SectionHeader title={t("home.cat.title")} subtitle={t("home.cat.sub")} href="/catalog" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
        {cats.map((cat) => {
          const visual = visualForCategory(cat);
          return (
            <Link
              key={cat.id}
              href={`/catalog/${cat.slug}`}
              className="group relative flex min-h-[132px] flex-col justify-between overflow-hidden rounded-2xl p-4 text-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-card sm:min-h-[148px] sm:p-5"
              style={{ background: `linear-gradient(135deg, ${cat.from}, ${cat.to})` }}
            >
              {visual && (
                <Image
                  src={visual.img}
                  alt=""
                  fill
                  sizes="(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 25vw"
                  className="object-cover transition duration-500 group-hover:scale-105"
                  style={{ objectPosition: visual.position }}
                />
              )}
              <span className={`absolute inset-0 bg-gradient-to-r ${visual?.overlay ?? "from-slate-900/85 via-slate-900/55 to-transparent"}`} />
              <div className="relative z-10 flex items-start justify-between">
                <span className="grid h-11 w-11 place-items-center rounded-xl border border-white/25 bg-white/15 text-white shadow-sm backdrop-blur-md transition group-hover:scale-110">
                  <CategoryIcon name={cat.icon} className="h-5 w-5" />
                </span>
                <span className="grid h-8 w-8 place-items-center rounded-full bg-white/15 text-white/90 opacity-0 backdrop-blur transition group-hover:opacity-100">
                  <ArrowUpRight className="h-4 w-4" />
                </span>
              </div>
              <div className="relative z-10 mt-4 max-w-[78%]">
                <p className="font-display text-base font-bold leading-tight drop-shadow-sm">{catalogCategoryName(cat.slug, cat.name, lang)}</p>
                {cat.count > 0 && <p className="mt-1 text-xs font-medium text-white/75">{cat.count} {plural(cat.count)}</p>}
              </div>
            </Link>
          );
        })}
        <Link
          href="/catalog"
          className="group flex min-h-[132px] flex-col justify-between rounded-2xl border border-brand-100 bg-brand-50 p-4 text-brand-900 transition hover:-translate-y-1 hover:bg-brand-100 hover:shadow-card sm:min-h-[148px] sm:p-5"
        >
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-white text-brand-700 shadow-sm">
            <ArrowUpRight className="h-5 w-5" />
          </span>
          <span>
            <span className="block font-display text-base font-bold">{t("home.cat.all")}</span>
            <span className="mt-1 block text-xs text-brand-700/70">{t("home.cat.all.sub")}</span>
          </span>
        </Link>
      </div>
    </section>
  );
}
