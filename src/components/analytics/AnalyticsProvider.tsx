"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { trackEvent } from "@/lib/analytics/client";
import { analyticsPath } from "@/lib/analytics/path";

export function AnalyticsProvider() {
  const pathname = usePathname();

  useEffect(() => {
    trackEvent("page_viewed", { path: analyticsPath(pathname) });
  }, [pathname]);

  useReportWebVitals((metric) => {
    trackEvent("web_vital", {
      metric: metric.name,
      value: Math.round(metric.value * 100) / 100,
      rating: metric.rating,
      navigationType: metric.navigationType,
    });
  });

  return null;
}
