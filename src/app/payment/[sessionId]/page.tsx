import type { Metadata } from "next";
import { PaymentPageClient } from "./PaymentPageClient";

export const metadata: Metadata = {
  title: "Безопасная оплата",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PaymentPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <PaymentPageClient sessionId={sessionId} />;
}
