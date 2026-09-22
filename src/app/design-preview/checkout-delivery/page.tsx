import { notFound } from "next/navigation";
import { CheckoutDeliveryPreview } from "./preview";

export default function CheckoutDeliveryPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CheckoutDeliveryPreview />;
}
