import type { Metadata } from "next";
// Самохостинг шрифтов (offline-сборка, без Google Fonts). index.css включает все
// нужные подмножества — latin + cyrillic (через unicode-range).
import "@fontsource-variable/inter";
import "@fontsource-variable/manrope";
import "./globals.css";
import { TopBar } from "@/components/layout/TopBar";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { CartProvider } from "@/lib/cart/CartContext";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { AuthProvider } from "@/lib/auth/AuthContext";
import { FavoritesProvider } from "@/lib/favorites/FavoritesContext";
import { AuthModal } from "@/components/auth/AuthModal";
import { ToastProvider } from "@/lib/ui/ToastContext";
import { ToastViewport } from "@/components/ui/ToastViewport";
import { ScannerProvider } from "@/lib/ui/ScannerContext";
import { ScannerModal } from "@/components/scanner/ScannerModal";
import { PharmaBackdrop } from "@/components/layout/PharmaBackdrop";
import { WelcomeModal } from "@/components/layout/WelcomeModal";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import { CityProvider } from "@/lib/location/CityContext";
import { ContentProvider } from "@/lib/content/ContentContext";
import { CatalogDataProvider } from "@/lib/content/CatalogData";
import { PushProvider } from "@/components/push/PushProvider";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { AnalyticsProvider } from "@/components/analytics/AnalyticsProvider";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/seo";
import { cookies } from "next/headers";
import type { Lang } from "@/lib/i18n/dict";

// Семейства из @fontsource-variable; CSS-переменные задаём на <html> ниже.
const FONT_VARS = {
  "--font-inter": '"Inter Variable"',
  "--font-manrope": '"Manrope Variable"',
} as React.CSSProperties;

export const metadata: Metadata = {
  metadataBase: siteUrl("/"),
  title: {
    default: "Аптека со склада — лекарства и товары для здоровья",
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    locale: "ru_KZ",
    siteName: SITE_NAME,
    title: "Аптека со склада",
    description: SITE_DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const savedLanguage = (await cookies()).get("inkar-lang-v1")?.value;
  const initialLang: Lang = savedLanguage === "kz" || savedLanguage === "en" ? savedLanguage : "ru";
  const documentLang = initialLang === "kz" ? "kk" : initialLang;
  return (
    <html lang={documentLang} style={FONT_VARS} data-scroll-behavior="smooth">
      <body className="relative isolate flex min-h-screen flex-col overflow-x-clip bg-[#f7fbf8] font-sans text-slate-900 antialiased">
        <PharmaBackdrop />
        <LanguageProvider initialLang={initialLang}>
        <CityProvider>
        <ContentProvider>
        <CatalogDataProvider>
        <ToastProvider>
          <ScannerProvider>
            <AuthProvider>
              <PushProvider>
              <FavoritesProvider>
                <CartProvider>
                  <AnalyticsProvider />
                  <TopBar />
                  <Header />
                  <main className="flex-1">{children}</main>
                  <Footer />
                  <MobileBottomNav />
                  <CartDrawer />
                  <AuthModal />
                  <ScannerModal />
                  <ToastViewport />
                  <WelcomeModal />
                </CartProvider>
              </FavoritesProvider>
              </PushProvider>
            </AuthProvider>
          </ScannerProvider>
        </ToastProvider>
        </CatalogDataProvider>
        </ContentProvider>
        </CityProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
