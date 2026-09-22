import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBrands, getProductsByBrand } from "@/lib/api";
import { BrandView } from "@/components/brands/BrandView";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const b = (await getBrands()).find((x) => x.slug === slug);
  return { title: b ? `${b.name} — Аптека со склада` : "Аптека со склада" };
}

export default async function BrandPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = (await getBrands()).find((b) => b.slug === slug);
  if (!brand) notFound();
  const list = await getProductsByBrand(slug);
  return <BrandView brand={brand} products={list} />;
}
