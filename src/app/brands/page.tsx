import { getBrands } from "@/lib/api";
import { BrandsList } from "@/components/brands/BrandsList";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function BrandsPage() {
  const brands = await getBrands();
  return <BrandsList brands={brands} />;
}
