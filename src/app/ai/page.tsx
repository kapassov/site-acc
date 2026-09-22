import type { Metadata } from "next";
import { AIConsultant } from "@/components/ai/AIConsultant";

export const metadata: Metadata = { title: "AI-фармацевт Saumi — Inkar" };

export default function AIPage() {
  return <AIConsultant />;
}
