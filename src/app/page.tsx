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

export default async function Home() {
  const [bestsellers, deals, brandList, seasonalResult, categoryTree] = await Promise.all([
    getBestsellers(),
    getDeals(),
    getBrands(6),
    getCategoryProducts("zagar-i-zashita-ot-solnca", 6).catch(() => ({ products: [], count: 0 })),
    getCatTree().catch(() => []),
  ]);
  // The current Medusa feed has no trustworthy created-at ordering yet, so the
  // "new" tab reuses the safe assortment instead of repeating the same query.
  const newArrivals = bestsellers;
  const seasonalProducts = seasonalResult.products.length ? seasonalResult.products : newArrivals;

  return (
    <div className="space-y-10 pb-4 sm:space-y-14">
      <div className="space-y-3 sm:space-y-4">
        <Hero />
        <HomeUtilityLinks />
      </div>
      <Reveal><FeaturedProductsTabs popular={bestsellers} deals={deals} newArrivals={newArrivals} /></Reveal>
      <Reveal><ProblemCollections /></Reveal>
      <Reveal><CategoryGrid /></Reveal>
      <Reveal><SeasonalCollection products={seasonalProducts} /></Reveal>
      <Reveal>
        <div className="space-y-7 sm:space-y-9">
          <PromoGrid />
          <BrandStrip brands={brandList} compact />
        </div>
      </Reveal>
      <Reveal>
        <div className="space-y-5 sm:space-y-7">
          <Features />
          <LoyaltyBanner />
        </div>
      </Reveal>
      <Reveal><CatalogDirectory tree={categoryTree} /></Reveal>
    </div>
  );
}
