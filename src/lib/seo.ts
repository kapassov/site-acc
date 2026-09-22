export const SITE_NAME = "Аптека со склада";
export const SITE_DESCRIPTION =
  "Лекарства, витамины, косметика и товары для здоровья с доставкой по Казахстану.";

export function siteUrl(path = "/"): URL {
  const configured = String(process.env.NEXT_PUBLIC_SITE_URL || "https://apteka-demo.quasar-it.kz").trim();
  return new URL(path, configured.endsWith("/") ? configured : `${configured}/`);
}
