"use client";

import { AlertCircle, BriefcaseBusiness, Building2, CheckCircle2, House, MapPin, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import type { DeliveryDetails, DeliveryPlaceType } from "@/lib/checkout/delivery-details";
import type { CheckoutExtraCopy } from "@/lib/i18n/checkout-extra";

const inputCls = "h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-base text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 sm:text-sm";

type Props = {
  copy: CheckoutExtraCopy;
  address: string;
  addressError?: string;
  addressReady: boolean;
  addressFocused: boolean;
  addressSuggestions: string[];
  details: DeliveryDetails;
  addressRef?: React.Ref<HTMLInputElement>;
  onAddressChange: (value: string) => void;
  onAddressFocus: () => void;
  onAddressBlur: () => void;
  onAddressSuggestion: (value: string) => void;
  onDetailsChange: (key: keyof DeliveryDetails, value: string | boolean) => void;
};

export function CourierDeliveryFields({
  copy, address, addressError, addressReady, addressFocused, addressSuggestions, details,
  addressRef, onAddressChange, onAddressFocus, onAddressBlur, onAddressSuggestion, onDetailsChange,
}: Props) {
  const detailCopy = copy.deliveryDetails;
  return (
    <div className="mt-3">
      <div className="min-w-0">
        <label htmlFor="checkout-address" className="mb-1.5 block text-sm font-semibold text-slate-700">
          {copy.field.address}<span className="ml-1 text-rose-500" aria-hidden>*</span>
        </label>
        <div className="relative">
          <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-brand-600" aria-hidden />
          <input
            id="checkout-address"
            ref={addressRef}
            value={address}
            onChange={(event) => onAddressChange(event.currentTarget.value)}
            onFocus={onAddressFocus}
            onBlur={onAddressBlur}
            placeholder={copy.field.addressPlaceholder}
            autoComplete="street-address"
            aria-invalid={Boolean(addressError)}
            aria-describedby={addressError ? "checkout-address-error" : undefined}
            className={cn(inputCls, "pl-10", addressReady && "pr-32", addressError && "border-rose-400 bg-rose-50/40 ring-2 ring-rose-100 focus:border-rose-500 focus:ring-rose-100")}
          />
          {addressReady && (
            <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1 text-xs font-semibold text-brand-700 min-[420px]:flex">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> {detailCopy.verified}
            </span>
          )}
          {addressFocused && addressSuggestions.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
              {addressSuggestions.map((suggestion) => (
                <li key={suggestion}>
                  <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onAddressSuggestion(suggestion)}
                    className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50">
                    <MapPin className="h-4 w-4 shrink-0 text-brand-600" aria-hidden /><span className="flex-1 truncate">{suggestion}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {addressError && <p id="checkout-address-error" role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-rose-600"><AlertCircle className="h-3.5 w-3.5 shrink-0" />{addressError}</p>}
      </div>

      <fieldset className="mt-4">
        <legend className="text-sm font-semibold text-slate-700">{detailCopy.placeType}</legend>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {([
            ["apartment", detailCopy.apartment, Building2],
            ["house", detailCopy.house, House],
            ["office", detailCopy.office, BriefcaseBusiness],
          ] as const).map(([value, label, Icon]) => {
            const active = details.placeType === value;
            return (
              <button key={value} type="button" aria-pressed={active} onClick={() => onDetailsChange("placeType", value as DeliveryPlaceType)}
                className={cn("flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border px-1.5 py-2 text-center text-xs font-semibold leading-tight transition sm:flex-row sm:gap-2 sm:text-sm", active ? "border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")}>
                <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {details.placeType === "house" ? (
        <div className="mt-4">
          <CompactDeliveryField id="checkout-gate" label={detailCopy.gateCode} value={details.intercom} placeholder={detailCopy.gateCodePlaceholder} autoComplete="off" onChange={(value) => onDetailsChange("intercom", value)} />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <CompactDeliveryField id="checkout-unit" label={details.placeType === "office" ? detailCopy.unitOffice : detailCopy.unitApartment} value={details.unit} placeholder={detailCopy.unitPlaceholder} inputMode="numeric" autoComplete={details.placeType === "apartment" ? "address-line2" : "organization"} onChange={(value) => onDetailsChange("unit", value)} />
          <CompactDeliveryField id="checkout-entrance" label={detailCopy.entrance} value={details.entrance} placeholder={detailCopy.entrancePlaceholder} inputMode="numeric" autoComplete="off" onChange={(value) => onDetailsChange("entrance", value)} />
          <CompactDeliveryField id="checkout-floor" label={detailCopy.floor} value={details.floor} placeholder={detailCopy.floorPlaceholder} inputMode="numeric" autoComplete="off" onChange={(value) => onDetailsChange("floor", value)} />
          <CompactDeliveryField id="checkout-intercom" label={detailCopy.intercom} value={details.intercom} placeholder={detailCopy.intercomPlaceholder} autoComplete="off" onChange={(value) => onDetailsChange("intercom", value)} />
        </div>
      )}

      <div className="mt-4">
        <label htmlFor="checkout-delivery-instructions" className="mb-1.5 block text-sm font-semibold text-slate-700">{detailCopy.instructions}</label>
        <textarea id="checkout-delivery-instructions" rows={3} maxLength={240} value={details.instructions} onChange={(event) => onDetailsChange("instructions", event.currentTarget.value)} placeholder={detailCopy.instructionsPlaceholder} className={cn(inputCls, "h-auto min-h-24 resize-y py-3")} />
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 transition has-[:checked]:border-brand-400 has-[:checked]:bg-brand-50/60">
        <input type="checkbox" checked={details.leaveAtDoor} onChange={(event) => onDetailsChange("leaveAtDoor", event.currentTarget.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" />
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-900">{detailCopy.leaveAtDoor}</span>
          <span className="mt-0.5 block text-xs text-slate-500">{detailCopy.leaveAtDoorHint}</span>
        </span>
      </label>

      <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-500">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
        <span>{detailCopy.privacy}</span>
      </p>
    </div>
  );
}

function CompactDeliveryField({
  id, label, value, placeholder, inputMode, autoComplete, onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block truncate text-xs font-semibold text-slate-600 sm:text-sm">{label}</label>
      <input id={id} value={value} maxLength={40} inputMode={inputMode} autoComplete={autoComplete} onChange={(event) => onChange(event.currentTarget.value)} placeholder={placeholder} className={cn(inputCls, "px-3")} />
    </div>
  );
}
