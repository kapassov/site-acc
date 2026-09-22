import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProductBySlug, getRelated, getVariants, getCategoryName } from "@/lib/api";
import { ProductDetail } from "@/components/product/ProductDetail";
import { SITE_NAME, siteUrl } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Товар не найден", robots: { index: false, follow: false } };
  const description = (product.description || `${product.name}${product.brand ? ` от ${product.brand}` : ""}. Цена и наличие в аптеках.`)
    .replace(/\s+/g, " ")
    .slice(0, 160);
  return {
    title: product.name,
    description,
    alternates: { canonical: `/product/${product.slug}` },
    openGraph: {
      type: "website",
      title: product.name,
      description,
      url: `/product/${product.slug}`,
      images: product.image ? [{ url: product.image, alt: product.name }] : undefined,
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const [related, variants, categoryName] = await Promise.all([
    getRelated(product),
    getVariants(product),
    product.categorySlug ? getCategoryName(product.categorySlug) : Promise.resolve(null),
  ]);

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description || product.name,
    sku: product.variantId || product.id,
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    image: product.images?.length ? product.images : product.image ? [product.image] : undefined,
    url: siteUrl(`/product/${product.slug}`).toString(),
    offers: !product.priceTBD && product.price > 0 ? {
      "@type": "Offer",
      priceCurrency: "KZT",
      price: product.price,
      availability: product.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: siteUrl(`/product/${product.slug}`).toString(),
      seller: { "@type": "Organization", name: SITE_NAME },
    } : undefined,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd).replace(/</g, "\\u003c") }}
      />
      <ProductDetail
        product={product}
        related={related}
        variants={variants}
        categoryName={categoryName ?? undefined}
        categorySlug={product.categorySlug || undefined}
      />
    </>
  );
}
