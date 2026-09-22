import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo";

const publicRoutes = [
  "",
  "catalog",
  "brands",
  "pharmacies",
  "promotions",
  "delivery",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return publicRoutes.map((route, index) => ({
    url: siteUrl(`/${route}`).toString(),
    lastModified: now,
    changeFrequency: index < 2 ? "daily" : "weekly",
    priority: index === 0 ? 1 : index === 1 ? 0.9 : 0.6,
  }));
}
