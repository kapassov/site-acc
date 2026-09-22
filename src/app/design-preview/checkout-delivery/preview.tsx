"use client";

import { useState } from "react";
import { Store, Truck } from "lucide-react";
import { CourierDeliveryFields } from "@/components/checkout/CourierDeliveryFields";
import { cn } from "@/lib/cn";
import { checkoutExtra } from "@/lib/i18n/checkout-extra";
import { EMPTY_DELIVERY_DETAILS, type DeliveryDetails } from "@/lib/checkout/delivery-details";

export function CheckoutDeliveryPreview() {
  const copy = checkoutExtra.ru;
  const [address, setAddress] = useState("пр. Сейфуллина, 51/12");
  const [details, setDetails] = useState<DeliveryDetails>({ ...EMPTY_DELIVERY_DETAILS, unit: "12", entrance: "2", floor: "5", leaveAtDoor: true });
  const setDetail = (key: keyof DeliveryDetails, value: string | boolean) => setDetails((current) => ({ ...current, [key]: value } as DeliveryDetails));

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-6 sm:px-6">
      <section className="mx-auto max-w-2xl rounded-2xl bg-white p-4 shadow-[0_14px_36px_-30px_rgba(15,23,42,0.55)] sm:p-6">
        <h1 className="font-display text-lg font-bold text-slate-900">1. Способ доставки</h1>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <PreviewMethod active icon={<Truck className="h-5 w-5" />} title="Курьером" text="30–60 минут" />
          <PreviewMethod icon={<Store className="h-5 w-5" />} title="Из аптеки" text="Самовывоз" />
        </div>
        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/50 p-3 sm:p-4">
          <h2 className="font-display text-base font-bold text-slate-900">{copy.deliveryDetails.title}</h2>
          <div className="mt-3">
          <label htmlFor="preview-city" className="mb-1.5 block text-sm font-semibold text-slate-700">Город <span className="text-rose-500">*</span></label>
          <input id="preview-city" value="Алматы" readOnly className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-base text-slate-800 outline-none sm:text-sm" />
          </div>
          <CourierDeliveryFields
            copy={copy}
            address={address}
            addressReady={/\d/.test(address)}
            addressFocused={false}
            addressSuggestions={[]}
            details={details}
            onAddressChange={setAddress}
            onAddressFocus={() => {}}
            onAddressBlur={() => {}}
            onAddressSuggestion={() => {}}
            onDetailsChange={setDetail}
          />
        </div>
      </section>
    </main>
  );
}

function PreviewMethod({ active, icon, title, text }: { active?: boolean; icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className={cn("flex min-h-20 items-start gap-3 rounded-xl border p-3 text-left sm:p-4", active ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500" : "border-slate-200 bg-slate-50/40")}>
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-500")}>{icon}</span>
      <span className="min-w-0"><span className="block text-sm font-semibold text-slate-900">{title}</span><span className="block text-xs text-slate-500">{text}</span></span>
    </div>
  );
}
