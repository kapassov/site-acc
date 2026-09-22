import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin/", "/account/", "/checkout/", "/api/"],
    },
    sitemap: siteUrl("/sitemap.xml").toString(),
    host: siteUrl("/").origin,
  };
}
