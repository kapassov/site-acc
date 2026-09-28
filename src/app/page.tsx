import { Suspense } from "react";
import { Hero } from "@/components/home/Hero";
import { HomeUtilityLinks } from "@/components/home/HomeUtilityLinks";
import { FeaturedProductsTabs } from "@/components/home/FeaturedProductsTabs";
import { ProblemCollections } from "@/components/home/ProblemCollections";
import { Features } from "@/components/home/Features";
import { CategoryGrid } from "@/components/home/CategoryGrid";
import { PromoGrid } from "@/components/home/PromoGrid";
import { SeasonalCollection } from "@/components/home/SeasonalCollection";
import { BrandStrip } from "@/components/home/BrandStrip";
import { LoyaltyBanner } from "@/components/home/LoyaltyBanner";
import { CatalogDirectory } from "@/components/home/CatalogDirectory";
import { Reveal } from "@/components/ui/Reveal";
import { getBestsellers, getDeals, getBrands, getCategoryProducts, getCatTree } from "@/lib/api";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function FeaturedCatalogProducts() {
  const [bestsellers, deals] = await Promise.all([getBestsellers(), getDeals()]);
  // The current Medusa feed has no trustworthy created-at ordering yet, so the
  // "new" tab reuses the safe assortment instead of repeating the same query.
  const newArrivals = bestsellers;
  return <Reveal><FeaturedProductsTabs popular={bestsellers} deals={deals} newArrivals={newArrivals} /></Reveal>;
}

async function SeasonalCatalogProducts() {
  const seasonalResult = await getCategoryProducts("zagar-i-zashita-ot-solnca", 6).catch(() => ({ products: [], count: 0 }));
  const products = seasonalResult.products.length ? seasonalResult.products : await getBestsellers();
  return <Reveal><SeasonalCollection products={products} /></Reveal>;
}

async function CatalogBrands() {
  return <BrandStrip brands={await getBrands(6)} compact />;
}

async function CatalogTree() {
  return <Reveal><CatalogDirectory tree={await getCatTree().catch(() => [])} /></Reveal>;
}

function SectionPlaceholder({ height }: { height: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-2xl bg-slate-100 ${height}`} />;
}

export default function Home() {
  return (
    <div className="space-y-10 pb-4 sm:space-y-14">
      <div className="space-y-3 sm:space-y-4">
        <Hero />
        <HomeUtilityLinks />
      </div>
      <Suspense fallback={<SectionPlaceholder height="min-h-72" />}><FeaturedCatalogProducts /></Suspense>
      <Reveal><ProblemCollections /></Reveal>
      <Reveal><CategoryGrid /></Reveal>
      <Suspense fallback={<SectionPlaceholder height="min-h-64" />}><SeasonalCatalogProducts /></Suspense>
      <Reveal>
        <div className="space-y-7 sm:space-y-9">
          <PromoGrid />
          <Suspense fallback={<SectionPlaceholder height="min-h-24" />}><CatalogBrands /></Suspense>
        </div>
      </Reveal>
      <Reveal>
        <div className="space-y-5 sm:space-y-7">
          <Features />
          <LoyaltyBanner />
        </div>
      </Reveal>
      <Suspense fallback={<SectionPlaceholder height="min-h-40" />}><CatalogTree /></Suspense>
    </div>
  );
}
