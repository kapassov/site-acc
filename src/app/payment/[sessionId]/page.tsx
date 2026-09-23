import type { Metadata } from "next";
import { PaymentPageClient } from "./PaymentPageClient";

export const metadata: Metadata = {
  title: "Безопасная оплата",
  robots: { index: false, follow: false },
  // The same-origin continuation POST needs a Referer fallback on iOS Safari,
  // which may omit Origin/Sec-Fetch-* for a native form navigation. The 303
  // response itself uses no-referrer, so the provider never receives it.
  referrer: "same-origin",
};

export default async function PaymentPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <PaymentPageClient sessionId={sessionId} />;
}
