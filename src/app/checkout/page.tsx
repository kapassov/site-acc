"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, ArrowRight, Truck, Store, CreditCard, Wallet, CheckCircle2, MapPin, LocateFixed, LoaderCircle, Sparkles } from "lucide-react";
import { useCart } from "@/lib/cart/CartContext";
import { useContent } from "@/lib/content/ContentContext";
import { useAuth } from "@/lib/auth/AuthContext";
import { useToast } from "@/lib/ui/ToastContext";
import { useLang } from "@/lib/i18n/LanguageContext";
import { checkoutDistance, checkoutExtra, checkoutNumber, checkoutText, type CheckoutExtraCopy } from "@/lib/i18n/checkout-extra";
import { canonicalCityName, cityDisplayName } from "@/lib/i18n/cities";
import { EmptyCart } from "@/components/cart/EmptyCart";
import { tenge } from "@/lib/format";
import { cn } from "@/lib/cn";
import { formatPhone } from "@/lib/phone";
import { isMedusaPickupPoint, type PickupPoint } from "@/lib/checkout/pickup-points";
import { PharmacyMapPicker } from "@/components/checkout/PharmacyMapPicker";
import { usePush } from "@/components/push/PushProvider";
import { LocalQrCode } from "@/components/checkout/LocalQrCode";
import { trackEvent } from "@/lib/analytics/client";
import { firstCheckoutFieldError, validateCheckoutFields, type CheckoutField, type CheckoutFieldErrors } from "@/lib/checkoutValidation";
import { GeolocationFailure, requestDeviceLocation } from "@/lib/checkout/pickup-geolocation";
import { loadNearestPickup, PickupLookupFailure } from "@/lib/checkout/nearest-pickup";
import { EMPTY_DELIVERY_DETAILS, type DeliveryDetails } from "@/lib/checkout/delivery-details";
import { CourierDeliveryFields } from "@/components/checkout/CourierDeliveryFields";
import { compareDeliveryChoices } from "@/lib/checkout/delivery-choice";

const inputCls =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-base text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 sm:text-sm";

type CheckoutQuote = {
  id: string;
  subtotal: number;
  total: number;
  currency: "KZT";
  expiresAt: string;
  pharmacy: { id: string; sourceCode?: string; name: string; city: string; address?: string } | null;
  lines: Array<{
    productId: string;
    variantId: string;
    sku?: string;
    quantity: number;
    availableQuantity: number;
    unitPrice: number;
    total: number;
  }>;
  adjustments?: Array<{ type: string; amount: number; provider?: string }>;
  delivery?: {
    provider: "yandex" | "choco" | "wolt";
    price: number;
    eta: number;
    distance: number;
  };
};

type FormErrorCode = "authRequired" | "requiredFields" | "quoteRequired" | "quoteChanged"
  | "orderStatusUncertain" | "paymentLinkUnavailable" | "orderAlreadyCreated" | "orderRejected";
type NearestErrorCode = "secureRequired" | "unsupported" | "permissionDenied" | "positionUnavailable" | "timeout" | "invalidPosition" | "lookupUnavailable" | "coordinatesUnavailable";
type PickupOption = PickupPoint & { total: number };

function isPickupOption(value: unknown): value is PickupOption {
  return isMedusaPickupPoint(value)
    && typeof (value as Partial<PickupOption>).total === "number"
    && Number.isFinite((value as Partial<PickupOption>).total)
    && Number((value as Partial<PickupOption>).total) > 0;
}

async function requestCheckoutQuote(
  path: "/api/checkout/quote" | "/api/checkout/courier-anchor",
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<CheckoutQuote> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.quote) throw new Error(String(data?.error || "quote_unavailable"));
  return data.quote as CheckoutQuote;
}

// Самовывоз: ручной выбор на карте или ближайшая аптека из каталога Medusa.

// Подсказки адреса — частые улицы/районы Алматы для умного поиска при вводе адреса.
const ALMATY_STREETS = [
  "пр. Абая", "пр. Достык", "пр. Аль-Фараби", "пр. Райымбека", "пр. Назарбаева",
  "пр. Сейфуллина", "пр. Гагарина", "пр. Абылай хана", "пр. Суюнбая",
  "ул. Толе би", "ул. Жандосова", "ул. Розыбакиева", "ул. Сатпаева", "ул. Богенбай батыра",
  "ул. Тимирязева", "ул. Шевченко", "ул. Жарокова", "ул. Майлина", "ул. Кабанбай батыра",
  "ул. Брусиловского", "ул. Ауэзова", "ул. Макатаева", "ул. Маметова", "ул. Пушкина",
  "ул. Гоголя", "ул. Байтурсынова", "ул. Муратбаева", "ул. Желтоксан", "ул. Курмангазы",
  "ул. Кунаева", "ул. Зенкова", "ул. Утеген батыра", "ул. Саина", "ул. Момышулы",
  "мкр. Самал-2", "мкр. Орбита-3", "мкр. Коктем-2", "мкр. Айнабулак-3", "мкр. Аксай-3",
  "мкр. Жетысу-2", "мкр. Таугуль", "мкр. Мамыр", "мкр. Казахфильм", "мкр. Дубок-2",
];

export default function CheckoutPage() {
  const {
    selectedItems,
    selectedSubtotal,
    selectedCount,
    cartInstanceId,
    removeSelected,
    legacyItemsRemoved,
  } = useCart();
  const { addOrder } = useContent();
  const { user, openLogin } = useAuth();
  const { push } = useToast();
  const { t, plural, lang } = useLang();
  const copy = checkoutExtra[lang];
  const { sendEvent } = usePush();
  const isDemo = user?.demo === true;

  const [delivery, setDelivery] = useState<"courier" | "pickup" | "post">("courier");
  const [payment, setPayment] = useState<"card" | "cash">("card");
  const [pharmacy, setPharmacy] = useState<PickupPoint | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  const [courierAnchor, setCourierAnchor] = useState<{ key: string; quote: CheckoutQuote } | null>(null);
  const [courierAnchorLoading, setCourierAnchorLoading] = useState(false);
  const [courierAnchorError, setCourierAnchorError] = useState("");
  const [courierAnchorRefresh, setCourierAnchorRefresh] = useState(0);
  const [cityDeliveryQuote, setCityDeliveryQuote] = useState<CheckoutQuote | null>(null);
  const [cityDeliveryLoading, setCityDeliveryLoading] = useState(false);
  const [cityDeliveryError, setCityDeliveryError] = useState(false);
  const [placed, setPlaced] = useState<string | null>(null);
  const [placedCode, setPlacedCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<FormErrorCode | null>(null);
  const [acceptedPriceSignature, setAcceptedPriceSignature] = useState("");
  const [fieldErrors, setFieldErrors] = useState<CheckoutFieldErrors>({});
  const [nameInput, setNameInput] = useState("");
  const [addr, setAddr] = useState("");
  const [city, setCity] = useState("Алматы");
  const [deliveryDetails, setDeliveryDetails] = useState<DeliveryDetails>(() => ({ ...EMPTY_DELIVERY_DETAILS }));
  const [livePharmacies, setLivePharmacies] = useState<{ key: string; city: string; points: PickupOption[] } | null>(null);
  const [pickupOptionsLoading, setPickupOptionsLoading] = useState(false);
  const [pickupOptionsError, setPickupOptionsError] = useState(false);
  const [nearestStatus, setNearestStatus] = useState<"idle" | "locating" | "loading">("idle");
  const [nearestError, setNearestError] = useState<NearestErrorCode | null>(null);
  const [nearestDistance, setNearestDistance] = useState<number | null>(null);
  const pharmacyListRequest = useRef<AbortController | null>(null);
  const nearestRequest = useRef<AbortController | null>(null);
  const cityDeliveryRequest = useRef<AbortController | null>(null);
  const [addrFocus, setAddrFocus] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneEdited, setPhoneEdited] = useState(false);
  const [desktopCheckout, setDesktopCheckout] = useState(false);
  const phoneRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const pharmacyRef = useRef<HTMLDivElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  const pickupItems = useMemo(() => selectedItems
    .filter((item) => item.product.variantId)
    .map((item) => ({ productId: item.product.id, variantId: item.product.variantId!, quantity: item.qty })), [selectedItems]);
  const pickupItemsSignature = pickupItems.map((item) => `${item.productId}:${item.variantId}:${item.quantity}`).join("|");
  const normalizedCity = city.trim();
  const pickupKey = `${normalizedCity.toLocaleLowerCase("ru-RU")}\u0000${pickupItemsSignature}`;
  const courierKey = `${normalizedCity.toLocaleLowerCase("ru-RU")}\u0000${pickupItemsSignature}`;
  const courierAnchorQuote = courierAnchor?.key === courierKey ? courierAnchor.quote : null;
  const loadedPharmacyKey = livePharmacies?.key;
  const cityPharmacies = livePharmacies && loadedPharmacyKey === pickupKey
    ? livePharmacies.points
    : [];
  // Keep the pharmacy identity stable if a background directory request changes ordering.
  const pharmacyIndex = cityPharmacies.findIndex((point) => (
    pharmacy?.sourceCode
      ? point.sourceCode === pharmacy.sourceCode
      : pharmacy?.address === point.address && pharmacy?.city === point.city
  ));
  const pharmIdx = Math.max(0, pharmacyIndex);
  const selectedPharmacy = pharmacyIndex >= 0 ? cityPharmacies[pharmacyIndex] : null;
  const locatingPharmacy = nearestStatus !== "idle";
  const fulfillment = delivery === "pickup" ? "pickup" : "pharmacy";
  const preferredPharmacyAddress = fulfillment === "pickup"
    ? selectedPharmacy?.address || ""
    : courierAnchorQuote?.pharmacy?.address || "";
  const preferredPharmacyCity = delivery === "courier"
    ? courierAnchorQuote?.pharmacy?.city || city
    : selectedPharmacy?.city || city;
  const preferredPharmacySourceCode = fulfillment === "pickup"
    ? selectedPharmacy?.sourceCode || ""
    : courierAnchorQuote?.pharmacy?.id || "";

  useEffect(() => {
    if (delivery !== "pickup" || !normalizedCity || !pickupItems.length || loadedPharmacyKey === pickupKey) return;
    const controller = new AbortController();
    pharmacyListRequest.current = controller;
    const timer = window.setTimeout(() => {
      setPickupOptionsLoading(true);
      setPickupOptionsError(false);
      fetch("/api/checkout/pickup-options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: pickupItems, city: normalizedCity }),
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error("pharmacies_unavailable"))))
        .then((payload) => {
          if (controller.signal.aborted) return;
          if (payload?.source !== "daribar_v3" || payload?.degraded !== false || !Array.isArray(payload?.pharmacies)) {
            throw new Error("pharmacies_unavailable");
          }
          const points = payload.pharmacies
            .filter(isPickupOption)
            .sort((left: PickupOption, right: PickupOption) => left.total - right.total
              || left.address.localeCompare(right.address, "ru"));
          setLivePharmacies({ key: pickupKey, city: normalizedCity, points });
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setPickupOptionsError(true);
            setLivePharmacies({ key: pickupKey, city: normalizedCity, points: [] });
          }
        })
        .finally(() => {
          if (pharmacyListRequest.current === controller) {
            pharmacyListRequest.current = null;
            setPickupOptionsLoading(false);
          }
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (pharmacyListRequest.current === controller) pharmacyListRequest.current = null;
    };
  }, [delivery, normalizedCity, pickupItems, pickupKey, loadedPharmacyKey]);

  useEffect(() => () => {
    nearestRequest.current?.abort();
    nearestRequest.current = null;
    cityDeliveryRequest.current?.abort();
    cityDeliveryRequest.current = null;
  }, [city, delivery]);

  useEffect(() => {
    if (selectedCount > 0) {
      trackEvent("checkout_started", { items: selectedCount, subtotal: selectedSubtotal });
    }
  }, [selectedCount, selectedSubtotal]);

  useEffect(() => {
    const desktopMedia = window.matchMedia("(min-width: 1024px)");
    const updateDesktopCheckout = () => setDesktopCheckout(desktopMedia.matches);
    updateDesktopCheckout();
    desktopMedia.addEventListener("change", updateDesktopCheckout);
    return () => desktopMedia.removeEventListener("change", updateDesktopCheckout);
  }, []);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("delivery");
    // The cart is the source of this one-time route selection; the effect keeps
    // the checkout page compatible with static rendering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (requested === "pickup" || requested === "courier") setDelivery(requested);
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- network quote state is intentionally reset when cart/fulfillment changes */
  useEffect(() => {
    if (delivery !== "courier" || !normalizedCity || !pickupItems.length) {
      setCourierAnchor(null);
      setCourierAnchorLoading(false);
      setCourierAnchorError("");
      setCityDeliveryQuote(null);
      setCityDeliveryLoading(false);
      setCityDeliveryError(false);
      return;
    }
    const controller = new AbortController();
    setCourierAnchor(null);
    setCourierAnchorLoading(true);
    setCourierAnchorError("");
    setCityDeliveryQuote(null);
    setCityDeliveryLoading(false);
    setCityDeliveryError(false);
    const timer = window.setTimeout(() => {
      requestCheckoutQuote("/api/checkout/courier-anchor", {
        items: pickupItems,
        city: normalizedCity,
      }, controller.signal)
        .then((nextQuote) => {
          if (!controller.signal.aborted) setCourierAnchor({ key: courierKey, quote: nextQuote });
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            setCourierAnchorError(error instanceof Error ? error.message : "quote_unavailable");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setCourierAnchorLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [delivery, normalizedCity, pickupItems, courierKey, courierAnchorRefresh]);

  useEffect(() => {
    const deliveryAddressReady = addr.trim().length > 0 && /\d/.test(addr);
    if (!pickupItems.length || (delivery === "pickup" && !preferredPharmacyAddress)
        || (delivery === "courier" && (!deliveryAddressReady || !preferredPharmacySourceCode))) {
      setQuote(null);
      setQuoteLoading(false);
      setQuoteError("");
      return;
    }
    const controller = new AbortController();
    setQuote(null);
    setQuoteLoading(true);
    setQuoteError("");
    cityDeliveryRequest.current?.abort();
    cityDeliveryRequest.current = null;
    setCityDeliveryQuote(null);
    setCityDeliveryLoading(false);
    setCityDeliveryError(false);
    const timer = window.setTimeout(() => requestCheckoutQuote("/api/checkout/quote", {
        items: pickupItems,
        fulfillment,
        preferredPharmacy: {
          id: preferredPharmacySourceCode || undefined,
          sourceCode: preferredPharmacySourceCode || undefined,
          address: preferredPharmacyAddress || undefined,
          city: preferredPharmacyCity,
        },
        ...(delivery === "courier" ? {
          deliveryRequest: {
            mode: "pharmacy",
            city: preferredPharmacyCity,
            address: addr,
            pharmacyId: preferredPharmacySourceCode,
          },
        } : {}),
      }, controller.signal)
      .then((nextQuote) => {
        if (!controller.signal.aborted) setQuote(nextQuote);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setQuote(null);
        setQuoteError(error instanceof Error ? error.message : "quote_unavailable");
      })
      .finally(() => {
        if (!controller.signal.aborted) setQuoteLoading(false);
      }), 450);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [pickupItems, delivery, fulfillment, preferredPharmacyAddress, preferredPharmacyCity, preferredPharmacySourceCode, addr, quoteRefresh]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!quote) return;
    const delay = Math.max(1_000, new Date(quote.expiresAt).getTime() - Date.now() - 15_000);
    const timer = window.setTimeout(() => setQuoteRefresh((value) => value + 1), delay);
    return () => window.clearTimeout(timer);
  }, [quote]);

  useEffect(() => {
    if (delivery !== "courier" || !courierAnchorQuote || quote) return;
    const delay = Math.max(1_000, new Date(courierAnchorQuote.expiresAt).getTime() - Date.now() - 15_000);
    const timer = window.setTimeout(() => setCourierAnchorRefresh((value) => value + 1), delay);
    return () => window.clearTimeout(timer);
  }, [delivery, courierAnchorQuote, quote]);

  if (placed) return <Success order={placed} code={placedCode} delivery={delivery} />;
  if (selectedCount === 0) {
    return (
      <EmptyCart
        text={legacyItemsRemoved
          ? copy.legacyCartEmpty
          : t("cart.checkoutEmpty.s")}
        backHref={legacyItemsRemoved ? "/catalog" : "/cart"}
      />
    );
  }

  const quotedFallback = selectedSubtotal;
  const goods = quote?.subtotal ?? (delivery === "courier" ? courierAnchorQuote?.subtotal : undefined) ?? quotedFallback;
  const pricedQuote = delivery === "courier" ? (quote ?? courierAnchorQuote) : quote;
  // A pickup row already displays its exact pharmacy total before selection,
  // so that click is the customer's explicit price choice. Courier pricing is
  // selected automatically and therefore needs a separate acknowledgement.
  const priceChanged = delivery === "courier"
    && Boolean(pricedQuote && Math.abs(goods - selectedSubtotal) >= 1);
  const priceSignature = priceChanged && pricedQuote
    ? `${selectedSubtotal}:${goods}:${pricedQuote.pharmacy?.id || "unknown"}`
    : "";
  const priceAccepted = !priceSignature || acceptedPriceSignature === priceSignature;
  const balance = user?.bonus ?? 0;
  const total = quote?.total ?? goods;
  const quoteIssue = quoteError || courierAnchorError;
  const cityDeliveryComparison = quote && cityDeliveryQuote
    ? compareDeliveryChoices(quote, cityDeliveryQuote)
    : null;
  // Умный поиск адреса: подсказки улиц Алматы по мере ввода (до первой цифры — номера дома).
  const addrQuery = addr.trim().toLowerCase();
  const addrSuggestions = addrFocus && addrQuery && !/\d/.test(addrQuery)
    ? ALMATY_STREETS.filter((s) => s.toLowerCase().includes(addrQuery)).slice(0, 5)
    : [];
  const displayedPhone = phoneEdited ? phoneInput : formatPhone(user?.phone ?? "");
  const displayedName = nameInput || (user?.name && user.name !== "Покупатель" ? user.name : "");
  const checkoutName = desktopCheckout ? (displayedName.trim() || user?.name?.trim() || "Покупатель") : displayedName;
  const checkoutPhone = desktopCheckout ? formatPhone(user?.phone ?? "") : displayedPhone;
  const nameReady = Boolean(checkoutName.trim());
  const phoneReady = checkoutPhone.replace(/\D/g, "").length >= 11;
  const cityReady = Boolean(city.trim());
  const destinationReady = delivery === "pickup" ? Boolean(selectedPharmacy) : addr.trim().length > 0 && /\d/.test(addr);
  const deliveryAddressReady = delivery === "courier" && destinationReady && Boolean(quote) && !quoteError;
  const checkoutRecoverable = formError === "orderStatusUncertain";
  const checkoutBlocked = formError === "paymentLinkUnavailable"
    || formError === "orderAlreadyCreated";
  const formActionable = !checkoutBlocked && priceAccepted && Boolean(user) && nameReady && phoneReady && cityReady && destinationReady && !!quote && !quoteLoading && !courierAnchorLoading && !quoteError && !locatingPharmacy;
  const mobileAction = checkoutBlocked
    ? copy.action.checkOrderStatus
    : submitting
    ? copy.action.submitting
    : checkoutRecoverable
      ? copy.action.retryOrderStatus
    : locatingPharmacy
      ? copy.action.choosingPharmacy
    : quoteLoading || courierAnchorLoading
      ? copy.action.checkingPrices
      : !priceAccepted
        ? copy.deliveryChoice.acceptPrice
      : !user
        ? copy.action.confirmPhone
      : !nameReady
        ? copy.action.enterName
      : !phoneReady
        ? copy.action.enterPhone
        : !cityReady
          ? copy.action.enterCity
        : !destinationReady
          ? delivery === "pickup" ? copy.action.choosePharmacy : copy.action.enterAddress
          : quoteIssue || !quote
            ? copy.action.refreshQuote
            : t("co.confirm");
  const hasPickupAlternatives = delivery === "pickup" && cityPharmacies.length > 0;
  const broadPickupError = quoteError === "no_common_pharmacy" || quoteError === "no_pharmacy_can_fulfill_cart";
  const quoteErrorText = quoteIssue === "selected_pharmacy_unavailable" || (broadPickupError && hasPickupAlternatives)
    ? copy.quoteError.selectedPharmacyUnavailable
    : broadPickupError
      ? copy.quoteError.noCommonPharmacy
      : quoteIssue === "stale_cart" || quoteIssue === "mixed_cart_sources" || quoteIssue === "cart_variant_mismatch"
        ? copy.quoteError.staleCart
      : quoteIssue === "cart_item_unavailable" || quoteIssue === "quote_stock_or_price_changed"
        ? copy.quoteError.itemUnavailable
      : quoteIssue === "stale_source_snapshot" || quoteIssue === "validated_snapshot_unavailable"
        ? copy.quoteError.staleSource
      : quoteIssue === "quote_snapshot_changed" || quoteIssue === "quote_items_mismatch" || quoteIssue === "quote_city_mismatch"
        ? copy.formError.quoteChanged
      : quoteIssue === "verified_customer_required"
        ? copy.formError.authRequired
      : quoteIssue === "medusa_timeout" || quoteIssue === "medusa_unavailable" || quoteIssue === "standardn_snapshot_unavailable"
        ? copy.quoteError.serviceUnavailable
      : quoteIssue
        ? copy.quoteError.generic
        : "";

  const formErrorText = formError ? copy.formError[formError] : "";
  const nearestErrorText = nearestError ? copy.nearest[nearestError] : "";
  const pickupOptionsReady = loadedPharmacyKey === pickupKey && !pickupOptionsLoading;
  const previousPharmacyUnavailable = delivery === "pickup" && Boolean(pharmacy) && pickupOptionsReady && !selectedPharmacy;
  const localizedFieldError = (field: CheckoutField): string | undefined => {
    if (!fieldErrors[field]) return undefined;
    if (field === "address" && addr.trim() && !/\d/.test(addr)) return copy.validation.houseNumber;
    return copy.validation[field];
  };

  const clearFieldError = (field: CheckoutField) => {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFormError(null);
  };

  const setDeliveryDetail = (key: keyof DeliveryDetails, value: string | boolean) => {
    setDeliveryDetails((current) => ({ ...current, [key]: value } as DeliveryDetails));
  };

  const findBetterCityDelivery = async () => {
    if (delivery !== "courier" || !quote || !quote.pharmacy?.id || !destinationReady || cityDeliveryLoading) return;
    const controller = new AbortController();
    cityDeliveryRequest.current = controller;
    setCityDeliveryLoading(true);
    setCityDeliveryError(false);
    setCityDeliveryQuote(null);
    try {
      const candidate = await requestCheckoutQuote("/api/checkout/quote", {
        items: pickupItems,
        fulfillment: "pharmacy",
        preferredPharmacy: {
          id: quote.pharmacy.id,
          sourceCode: quote.pharmacy.id,
          address: quote.pharmacy.address,
          city: quote.pharmacy.city || city,
        },
        deliveryRequest: {
          mode: "city",
          city: quote.pharmacy.city || city,
          address: addr,
          pharmacyId: quote.pharmacy.id,
        },
      }, controller.signal);
      if (controller.signal.aborted || cityDeliveryRequest.current !== controller) return;
      setCityDeliveryQuote(candidate);
      trackEvent("delivery_city_compared", {
        currentTotal: quote.total,
        candidateTotal: candidate.total,
        changedPharmacy: candidate.pharmacy?.id !== quote.pharmacy.id,
      });
    } catch {
      if (!controller.signal.aborted) setCityDeliveryError(true);
    } finally {
      if (cityDeliveryRequest.current === controller) {
        cityDeliveryRequest.current = null;
        setCityDeliveryLoading(false);
      }
    }
  };

  const applyCityDelivery = () => {
    if (!cityDeliveryQuote || !cityDeliveryComparison?.isCheaper || !cityDeliveryQuote.pharmacy?.id) return;
    const previousTotal = quote?.total ?? total;
    setCourierAnchor({ key: courierKey, quote: cityDeliveryQuote });
    setQuote(cityDeliveryQuote);
    setQuoteError("");
    setCityDeliveryQuote(null);
    setCityDeliveryError(false);
    trackEvent("delivery_city_option_selected", {
      previousTotal,
      total: cityDeliveryQuote.total,
      savings: cityDeliveryComparison.savings,
      pharmacyId: cityDeliveryQuote.pharmacy.id,
    });
  };

  const cancelNearestPickup = () => {
    nearestRequest.current?.abort();
    nearestRequest.current = null;
    setNearestStatus("idle");
    setNearestError(null);
    setNearestDistance(null);
  };

  const chooseNearestPickup = async () => {
    if (nearestRequest.current || submitting || delivery !== "pickup") return;
    setNearestError(null);
    setNearestDistance(null);
    if (!window.isSecureContext) {
      setNearestError("secureRequired");
      return;
    }
    const controller = new AbortController();
    nearestRequest.current = controller;
    setNearestStatus("locating");
    try {
      // The native permission prompt is triggered only by this explicit button click.
      const location = await requestDeviceLocation(navigator.geolocation, controller.signal);
      if (controller.signal.aborted) return;
      setNearestStatus("loading");
      const nearest = await loadNearestPickup(location, controller.signal, fetch, pickupItems);
      if (controller.signal.aborted || nearestRequest.current !== controller) return;
      // Apply city, directory and selection together; a late city request must not reset them.
      pharmacyListRequest.current?.abort();
      const eligiblePoints = nearest.points.filter(isPickupOption) as PickupOption[];
      const nearestKey = `${nearest.city.trim().toLocaleLowerCase("ru-RU")}\u0000${pickupItemsSignature}`;
      setLivePharmacies({ key: nearestKey, city: nearest.city, points: eligiblePoints });
      setCity(nearest.city);
      setPharmacy(nearest.pharmacy);
      setNearestDistance(nearest.distanceKm);
      clearFieldError("city");
      clearFieldError("pharmacy");
      setQuote(null);
      setQuoteError("");
      setQuoteLoading(true);
      setQuoteRefresh((value) => value + 1);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof PickupLookupFailure) {
        setNearestError(error.code === "coordinates_unavailable" ? "coordinatesUnavailable" : "lookupUnavailable");
      } else if (error instanceof GeolocationFailure) {
        const code: NearestErrorCode = error.code === "permission_denied"
          ? "permissionDenied"
          : error.code === "position_unavailable"
            ? "positionUnavailable"
            : error.code === "invalid_position"
              ? "invalidPosition"
              : error.code === "unsupported"
                ? "unsupported"
                : error.code === "timeout"
                  ? "timeout"
                  : "positionUnavailable";
        setNearestError(code);
      } else {
        setNearestError("positionUnavailable");
      }
    } finally {
      if (nearestRequest.current === controller) {
        nearestRequest.current = null;
        setNearestStatus("idle");
      }
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || locatingPharmacy || nearestRequest.current) return;
    setFormError(null);
    if (!priceAccepted && priceSignature) {
      setAcceptedPriceSignature(priceSignature);
      push(copy.deliveryChoice.priceAccepted);
      return;
    }
    if (!user) {
      setFormError("authRequired");
      push(copy.formError.authRequired);
      openLogin();
      return;
    }
    const name = checkoutName;
    const phoneValue = desktopCheckout ? checkoutPhone : (phoneRef.current?.value ?? displayedPhone);
    const errors = validateCheckoutFields({
      name,
      phone: phoneValue,
      city,
      address: addr,
      delivery,
      pickupAvailable: Boolean(selectedPharmacy),
    });
    setFieldErrors(errors);
    const firstError = firstCheckoutFieldError(errors);
    if (firstError) {
      setFormError("requiredFields");
      push(copy.formError.requiredFields);
      const target = firstError === "name" ? nameRef.current
        : firstError === "phone" ? phoneRef.current
          : firstError === "city" ? cityRef.current
            : firstError === "address" ? addressRef.current
              : pharmacyRef.current;
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (target instanceof HTMLInputElement) target.focus();
      return;
    }
    const phoneDigits = phoneValue.replace(/\D/g, "");
    if (!quote || quoteLoading || quoteError) {
      setFormError("quoteRequired");
      push(copy.formError.quoteRequired);
      if (!quoteLoading) setQuoteRefresh((value) => value + 1);
      return;
    }
    setSubmitting(true);
    trackEvent("order_submitted", {
      items: selectedCount,
      total,
      delivery,
      fulfillment,
      payment: isDemo ? "cash" : payment,
    });
    try {
      const order = await addOrder({
        sum: total,
        items: selectedCount,
        delivery,
        payment: isDemo ? "cash" : payment,
        name,
        phone: phoneDigits,
        email: user?.email,
        address: delivery === "pickup" ? (selectedPharmacy?.address || city) : addr,
        city,
        quoteId: quote.id,
        fulfillment,
        pharmacyId: quote.pharmacy?.id,
        pharmacyName: quote.pharmacy?.name,
        pharmacyAddress: quote.pharmacy?.address,
        comment: delivery === "pickup" ? commentRef.current?.value || "" : "",
        ...(delivery === "courier" ? { deliveryDetails } : {}),
        cartInstanceId,
        cartItems: pickupItems,
      });
      await sendEvent("order.created", {
        orderId: order.id,
        orderNumber: order.n,
        code: order.code || "",
        url: "/account/orders",
      }).catch(() => {});
      removeSelected();
      trackEvent("order_confirmed", {
        orderId: order.id,
        items: selectedCount,
        total,
        delivery,
      });
      setPlacedCode(order.code || "");
      setPlaced("INK-" + order.n);
      window.scrollTo({ top: 0 });
    } catch (error) {
      if (error instanceof Error && error.message === "payment_redirect") return;
      if (error instanceof Error && /^(?:quote_(?:invalid_or_expired|required|snapshot_changed|stock_or_price_changed|items_mismatch|city_mismatch)|no_pharmacy_can_fulfill_cart|stale_source_snapshot)$/.test(error.message)) {
        setQuote(null);
        setQuoteRefresh((value) => value + 1);
        setFormError("quoteChanged");
        push(copy.formError.quoteRefreshing);
      } else if (error instanceof Error && ["order_status_uncertain", "checkout_attempt_conflict"].includes(error.message)) {
        setFormError("orderStatusUncertain");
        push(copy.formError.orderStatusUncertain);
      } else if (error instanceof Error && error.message === "payment_link_unavailable") {
        setFormError("paymentLinkUnavailable");
        push(copy.formError.paymentLinkUnavailable);
      } else if (error instanceof Error && error.message === "order_already_created") {
        setFormError("orderAlreadyCreated");
        push(copy.formError.orderAlreadyCreated);
      } else if (error instanceof Error && error.message === "daribar_order_rejected") {
        setFormError("orderRejected");
        push(copy.formError.orderRejected);
      } else if (error instanceof Error && ["daribar_auth_required", "verified_customer_required"].includes(error.message)) {
        setFormError("authRequired");
        push(copy.formError.authRequired);
        openLogin();
      } else {
        push(copy.formError.orderFailed);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="relative z-0 mx-auto min-h-screen max-w-5xl px-3 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-0 sm:px-6 lg:pb-12 before:fixed before:inset-0 before:-z-10 before:bg-slate-50"
    >
      <div className="-mx-3 flex min-h-16 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:-mx-6 md:mb-10 md:px-6">
        <Link href="/cart" aria-label={copy.navigation.backToCart} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-700 active:bg-slate-100">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <span className="font-semibold text-slate-800">{copy.navigation.back}</span>
      </div>
      <div className="mt-5 md:mt-0">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-slate-900 md:text-3xl">{t("co.title")}</h1>
        <CheckoutProgress copy={copy.progress} />
      </div>
      {legacyItemsRemoved && (
        <div role="status" className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {copy.legacyNotice.text}{" "}
          <Link href="/catalog" className="font-semibold underline underline-offset-2">{copy.legacyNotice.catalog}</Link>
        </div>
      )}
      {formErrorText && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <span className="min-w-0">
            <span className="block">{formErrorText}</span>
            {checkoutRecoverable && (
              <span className="mt-2 flex flex-wrap gap-2">
                <button type="submit" className="inline-flex min-h-10 items-center rounded-xl bg-rose-700 px-3 text-white transition hover:bg-rose-800">
                  {copy.action.retryOrderStatus}
                </button>
                <Link href="/account/orders" className="inline-flex min-h-10 items-center rounded-xl border border-rose-300 bg-white px-3 text-rose-800 transition hover:bg-rose-100">
                  {copy.payment.checkOrders}
                </Link>
              </span>
            )}
            {checkoutBlocked && (
              <Link href="/account/orders" className="mt-2 inline-flex min-h-10 items-center rounded-xl border border-rose-300 bg-white px-3 text-rose-800 transition hover:bg-rose-100">
                {copy.payment.checkOrders}
              </Link>
            )}
          </span>
        </div>
      )}

      <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_350px] lg:items-start">
        <div className="min-w-0 space-y-5">
          <div className="lg:hidden">
            <Section title={t("co.s1")}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="checkout-name" label={copy.field.recipientName} required error={localizedFieldError("name")}>
                  <input id="checkout-name" ref={nameRef} value={displayedName} onChange={(event) => { setNameInput(event.currentTarget.value); clearFieldError("name"); }} placeholder={t("co.name")} autoComplete="name" aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? "checkout-name-error" : undefined} className={cn(inputCls, fieldErrors.name && "border-rose-400 bg-rose-50/40 ring-2 ring-rose-100 focus:border-rose-500 focus:ring-rose-100")} />
                </Field>
                <Field id="checkout-phone" label={copy.field.phone} required error={localizedFieldError("phone")}>
                  <input
                    id="checkout-phone"
                    ref={phoneRef}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={displayedPhone}
                    onChange={(e) => {
                      setPhoneEdited(true);
                      setPhoneInput(formatPhone(e.currentTarget.value));
                      clearFieldError("phone");
                    }}
                    placeholder="+7 (___) ___-__-__"
                    aria-invalid={Boolean(fieldErrors.phone)}
                    aria-describedby={fieldErrors.phone ? "checkout-phone-error" : undefined}
                    className={cn(inputCls, fieldErrors.phone && "border-rose-400 bg-rose-50/40 ring-2 ring-rose-100 focus:border-rose-500 focus:ring-rose-100")}
                  />
                </Field>
              </div>
            </Section>
          </div>

          <Section title={t("co.s2")} desktopTitle={copy.section.delivery}>
            <div className="grid gap-3 sm:grid-cols-2">
              <RadioCard active={delivery === "courier"} onClick={() => { cancelNearestPickup(); setDelivery("courier"); clearFieldError("pharmacy"); }} icon={<Truck className="h-5 w-5" />} title={t("co.courier")} text={t("co.courier.s")} />
              <RadioCard active={delivery === "pickup"} onClick={() => { cancelNearestPickup(); setDelivery("pickup"); clearFieldError("address"); }} icon={<Store className="h-5 w-5" />} title={t("co.pickup")} text={t("co.pickup.s")} />
            </div>
            <div className={cn("mt-3 space-y-2", delivery === "courier" && "rounded-2xl border border-slate-200 bg-slate-50/50 p-3 sm:p-4")}>
              {delivery === "courier" && <h3 className="font-display text-base font-bold text-slate-900">{copy.deliveryDetails.title}</h3>}
              <Field id="checkout-city" label={copy.field.city} required error={localizedFieldError("city")}>
                <input id="checkout-city" ref={cityRef} value={cityDisplayName(city, lang)} onChange={(e) => { cancelNearestPickup(); setCity(canonicalCityName(e.target.value)); setPharmacy(null); setLivePharmacies(null); setQuote(null); clearFieldError("city"); }} placeholder={t("co.city")} autoComplete="address-level2" aria-invalid={Boolean(fieldErrors.city)} aria-describedby={fieldErrors.city ? "checkout-city-error" : undefined} className={cn(inputCls, fieldErrors.city && "border-rose-400 bg-rose-50/40 ring-2 ring-rose-100 focus:border-rose-500 focus:ring-rose-100")} />
              </Field>
              {delivery === "pickup" ? (
                <div ref={pharmacyRef} className="space-y-2 scroll-mt-24">
                  <button
                    type="button"
                    onClick={chooseNearestPickup}
                    disabled={locatingPharmacy || submitting}
                    aria-busy={locatingPharmacy}
                    aria-describedby="pickup-location-status"
                    className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2.5 text-sm font-semibold leading-5 text-brand-800 transition hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
                  >
                    {locatingPharmacy
                      ? <LoaderCircle className="h-5 w-5 shrink-0 motion-safe:animate-spin" aria-hidden />
                      : <LocateFixed className="h-5 w-5 shrink-0" aria-hidden />}
                    <span>{nearestStatus === "locating" ? copy.nearest.locating : nearestStatus === "loading" ? copy.nearest.loading : copy.nearest.choose}</span>
                  </button>
                  <p
                    id="pickup-location-status"
                    role={nearestError ? "alert" : "status"}
                    aria-atomic="true"
                    className={cn("text-xs leading-5", nearestError ? "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900" : "px-0.5 text-slate-500")}
                  >
                    {nearestErrorText || (nearestStatus === "locating"
                      ? copy.nearest.permissionHint
                      : nearestStatus === "loading"
                        ? copy.nearest.comparing
                        : nearestDistance !== null
                          ? checkoutText(copy.nearest.selected, { distance: checkoutDistance(nearestDistance, lang), city: cityDisplayName(city, lang) })
                          : copy.nearest.idleHint)}
                  </p>
                  <div className={cn(
                    "flex items-center gap-3 rounded-xl border p-3",
                    fieldErrors.pharmacy
                      ? "border-rose-400 bg-rose-50/40 ring-2 ring-rose-100"
                      : previousPharmacyUnavailable
                        ? "border-amber-300 bg-amber-50"
                        : selectedPharmacy
                          ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500"
                          : "border-slate-200 bg-white",
                  )}>
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><Store className="h-5 w-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-900">{selectedPharmacy?.address ?? copy.pickupOptions.noSelection}</span>
                      <span className={cn("block text-xs", previousPharmacyUnavailable ? "text-amber-800" : "text-slate-500")}>
                        {previousPharmacyUnavailable ? copy.pickupOptions.unavailable : selectedPharmacy?.hours ?? ""}
                      </span>
                    </span>
                  </div>
                  {pickupOptionsLoading ? (
                    <p role="status" className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-600">{copy.pickupOptions.loading}</p>
                  ) : pickupOptionsError ? (
                    <button type="button" onClick={() => { setLivePharmacies(null); setPickupOptionsError(false); }}
                      className="min-h-11 w-full rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm font-medium text-amber-900">
                      {copy.pickupOptions.failed}
                    </button>
                  ) : pickupOptionsReady && cityPharmacies.length === 0 ? (
                    <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">{copy.pickupOptions.empty}</p>
                  ) : cityPharmacies.length > 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-2">
                      <p className="px-2 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{copy.pickupOptions.title}</p>
                      <div className="max-h-64 space-y-1 overflow-y-auto overscroll-contain">
                        {cityPharmacies.map((point) => {
                          const active = selectedPharmacy?.sourceCode === point.sourceCode;
                          return (
                            <button key={point.sourceCode} type="button" onClick={() => {
                              cancelNearestPickup();
                              setPharmacy(point);
                              setQuote(null);
                              setQuoteError("");
                              clearFieldError("pharmacy");
                            }} className={cn(
                              "flex min-h-14 w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
                              active ? "bg-brand-50" : "hover:bg-slate-50",
                            )}>
                              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-500")}>
                                {active ? <CheckCircle2 className="h-5 w-5" /> : <Store className="h-5 w-5" />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-slate-900">{point.address}</span>
                                <span className="block text-xs text-slate-500">{point.hours}</span>
                              </span>
                              <span className="shrink-0 text-right">
                                <span className="block text-sm font-bold text-slate-900">{tenge(point.total)}</span>
                                <span className={cn("block text-xs font-semibold", active ? "text-brand-700" : "text-slate-500")}>
                                  {active ? copy.pickupOptions.selected : copy.pickupOptions.choose}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  <button type="button" onClick={() => { cancelNearestPickup(); setMapOpen(true); }}
                    disabled={cityPharmacies.length === 0 || pickupOptionsLoading}
                    className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-brand-500 px-3 py-2.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 disabled:hover:bg-white">
                    <MapPin className="h-5 w-5 shrink-0" aria-hidden /> {copy.nearest.chooseOnMap}
                  </button>
                  {localizedFieldError("pharmacy") && <p role="alert" className="text-xs font-semibold text-rose-600">{localizedFieldError("pharmacy")}</p>}
                </div>
              ) : (
                <>
                  <CourierDeliveryFields
                    copy={copy}
                    address={addr}
                    addressError={localizedFieldError("address")}
                    addressReady={deliveryAddressReady}
                    addressFocused={addrFocus}
                    addressSuggestions={addrSuggestions}
                    details={deliveryDetails}
                    addressRef={addressRef}
                    onAddressChange={(value) => { setAddr(value); clearFieldError("address"); }}
                    onAddressFocus={() => setAddrFocus(true)}
                    onAddressBlur={() => window.setTimeout(() => setAddrFocus(false), 150)}
                    onAddressSuggestion={(value) => { setAddr(value + ", "); setAddrFocus(false); }}
                    onDetailsChange={setDeliveryDetail}
                  />
                  <CourierPriceChoice
                    copy={copy}
                    cityName={cityDisplayName(city, lang)}
                    anchor={courierAnchorQuote}
                    quote={quote}
                    anchorLoading={courierAnchorLoading}
                    anchorError={Boolean(courierAnchorError)}
                    cityQuote={cityDeliveryQuote}
                    cityLoading={cityDeliveryLoading}
                    cityError={cityDeliveryError}
                    comparison={cityDeliveryComparison}
                    catalogueSubtotal={selectedSubtotal}
                    priceAccepted={priceAccepted}
                    onAcceptPrice={() => setAcceptedPriceSignature(priceSignature)}
                    onRetryAnchor={() => setCourierAnchorRefresh((value) => value + 1)}
                    onFindCity={findBetterCityDelivery}
                    onApplyCity={applyCityDelivery}
                  />
                </>
              )}
            </div>
          </Section>

          <PharmacyMapPicker
            open={mapOpen}
            city={city}
            points={cityPharmacies}
            initialIndex={pharmIdx}
            onClose={() => setMapOpen(false)}
            onPick={(point) => { cancelNearestPickup(); setPharmacy(point); clearFieldError("pharmacy"); }}
          />

          <Section title={t("co.s3")} desktopTitle={copy.section.payment}>
            <div className="grid gap-3 sm:grid-cols-2">
              {!isDemo && (
                <RadioCard active={payment === "card"} onClick={() => setPayment("card")} icon={<CreditCard className="h-5 w-5" />} title={t("co.card")} text={t("co.card.s")} />
              )}
              <RadioCard
                active={isDemo || payment === "cash"}
                onClick={() => setPayment("cash")}
                icon={<Wallet className="h-5 w-5" />}
                title={isDemo ? copy.payment.demoTitle : t("co.cash")}
                text={isDemo ? copy.payment.demoText : t("co.cash.s")}
              />
            </div>
            {!isDemo && payment === "card" && (
              <p className="mt-3 rounded-xl border border-brand-100 bg-brand-50/60 p-3 text-sm text-brand-800">
                {copy.payment.providerHint}
              </p>
            )}
          </Section>

          {delivery === "pickup" && (
            <Section title={t("co.s4")} desktopTitle={copy.section.comment}>
              <textarea ref={commentRef} rows={3} maxLength={500} placeholder={t("co.comment")} className={cn(inputCls, "h-auto py-3")} />
            </Section>
          )}
        </div>

        <aside className="min-w-0">
          <div className="sticky top-6 flex flex-col gap-4">
            <div className="rounded-2xl border border-slate-100 p-4">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Sparkles className="h-4 w-4 text-brand-600" /> {copy.bonus.title}</span>
              <p className="mt-2 text-xs text-slate-500">{balance > 0 ? checkoutText(copy.bonus.available, { balance: checkoutNumber(balance, lang), points: t("sum.points") }) : copy.bonus.empty}</p>
            </div>

            <div className="order-first rounded-2xl bg-white p-5 shadow-[0_14px_36px_-30px_rgba(15,23,42,0.55)]">
              <h2 className="font-display text-lg font-bold text-slate-900">{t("sum.title")}</h2>
              <div className={cn(
                "mt-3 rounded-xl p-3 text-sm",
                quoteIssue
                  ? "bg-amber-50 text-amber-900"
                  : quote
                    ? "bg-brand-50 text-brand-800"
                    : "bg-slate-100 text-slate-700",
              )}>
                <p className="font-semibold">
                  {quoteLoading || courierAnchorLoading
                    ? copy.availability.checking
                    : quote
                      ? copy.availability.confirmed
                      : quoteIssue
                        ? copy.availability.failed
                        : copy.availability.confirming}
                </p>
                <p className="mt-0.5 text-xs opacity-75">
                  {quote
                    ? delivery === "pickup" ? copy.availability.pickupReady : copy.availability.deliveryReady
                    : quoteLoading || courierAnchorLoading ? copy.availability.comparing : copy.availability.preflight}
                </p>
              </div>
              {(quote?.lines?.length ?? 0) > 0 && (
                <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-100 bg-slate-50/60 px-3">
                  {(quote?.lines ?? []).map((line) => {
                    const product = selectedItems.find((item) => (
                      item.product.id === line.productId && item.product.variantId === line.variantId
                    ))?.product;
                    const lowStock = line.availableQuantity <= Math.max(3, line.quantity);
                    return (
                      <li key={`${line.productId}:${line.variantId}`} className="py-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <p className="min-w-0 line-clamp-2 text-xs font-semibold leading-4 text-slate-800">
                            {product?.name || copy.orderLine.product}
                          </p>
                          <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-700">{tenge(line.total)}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                          <span className="text-slate-500">{checkoutText(copy.orderLine.inCart, { quantity: line.quantity })}</span>
                          <span className={cn("font-semibold", lowStock ? "text-amber-700" : "text-brand-700")}>
                            {lowStock ? copy.orderLine.left : copy.orderLine.inStock}: {line.availableQuantity} {copy.orderLine.pieces}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <dl className="mt-4 space-y-2.5 text-sm">
                <Row label={`${selectedCount} ${plural(selectedCount)}`} value={tenge(goods)} />
                {delivery === "courier" && quote?.delivery && (
                  <Row label={`${t("sum.delivery")} · ~${Math.round(quote.delivery.eta)} мин`} value={tenge(quote.delivery.price)} />
                )}
              </dl>
              <div className="mt-4 flex items-end justify-between border-t border-slate-100 pt-4">
                <span className="text-slate-600">{t("sum.total")}</span>
                <span className="font-display text-2xl font-extrabold text-slate-900">{tenge(total)}</span>
              </div>
              {(quoteLoading || courierAnchorLoading) && <p className="mt-2 text-xs text-slate-500">{copy.availability.checkingPrices}</p>}
              {quote?.pharmacy && <p className="mt-2 text-xs text-brand-700">{checkoutText(copy.availability.preparedBy, { pharmacy: `${quote.pharmacy.name}${quote.pharmacy.address ? `, ${quote.pharmacy.address}` : ""}` })}</p>}
              {quoteErrorText && (
                <div role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <p>{quoteErrorText}</p>
                  <button type="button" onClick={() => setQuoteRefresh((value) => value + 1)} className="mt-2 font-semibold underline underline-offset-2">{copy.availability.retry}</button>
                </div>
              )}
              <button type="submit" disabled={checkoutBlocked || submitting || quoteLoading || courierAnchorLoading || locatingPharmacy} className={cn("mt-5 hidden h-12 w-full rounded-xl font-semibold text-white transition lg:block", formActionable ? "bg-brand-600 hover:bg-brand-700" : "bg-brand-600 hover:bg-brand-700", "disabled:cursor-wait disabled:opacity-60")}>{mobileAction}</button>
            </div>
            <p className="px-2 text-center text-xs text-slate-400">{t("co.consent")}</p>
          </div>
        </aside>
      </div>

      <div
        className="fixed inset-x-0 z-[70] border-t border-slate-200 bg-white/96 px-3 pt-3 shadow-[0_-10px_30px_-18px_rgba(15,23,42,0.35)] backdrop-blur-xl [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden"
        style={{ bottom: "env(keyboard-inset-height, 0px)" }}
      >
        <div className="mx-auto max-w-md">
          <button
            type="submit"
            disabled={checkoutBlocked || submitting || quoteLoading || courierAnchorLoading || locatingPharmacy}
            className="flex min-h-13 w-full min-w-0 items-center justify-between gap-3 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-wait disabled:bg-slate-200 disabled:text-slate-500"
          >
            <span className="shrink-0 font-display text-base font-extrabold tabular-nums">{tenge(total)}</span>
            <span className="min-w-0 truncate">{mobileAction}</span>
          </button>
        </div>
      </div>
    </form>
  );
}

function CourierPriceChoice({
  copy,
  cityName,
  anchor,
  quote,
  anchorLoading,
  anchorError,
  cityQuote,
  cityLoading,
  cityError,
  comparison,
  catalogueSubtotal,
  priceAccepted,
  onAcceptPrice,
  onRetryAnchor,
  onFindCity,
  onApplyCity,
}: {
  copy: CheckoutExtraCopy;
  cityName: string;
  anchor: CheckoutQuote | null;
  quote: CheckoutQuote | null;
  anchorLoading: boolean;
  anchorError: boolean;
  cityQuote: CheckoutQuote | null;
  cityLoading: boolean;
  cityError: boolean;
  comparison: ReturnType<typeof compareDeliveryChoices> | null;
  catalogueSubtotal: number;
  priceAccepted: boolean;
  onAcceptPrice: () => void;
  onRetryAnchor: () => void;
  onFindCity: () => void;
  onApplyCity: () => void;
}) {
  const current = quote ?? anchor;
  const changed = Boolean(current && Math.abs(current.subtotal - catalogueSubtotal) >= 1);
  if (anchorLoading && !current) {
    return (
      <div role="status" className="flex min-h-20 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
        <LoaderCircle className="h-5 w-5 shrink-0 motion-safe:animate-spin" aria-hidden />
        <span>{copy.deliveryChoice.loading}</span>
      </div>
    );
  }
  if (anchorError && !current) {
    return (
      <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p>{copy.quoteError.generic}</p>
        <button type="button" onClick={onRetryAnchor} className="mt-2 min-h-10 font-semibold underline underline-offset-2">
          {copy.availability.retry}
        </button>
      </div>
    );
  }
  if (!current?.pharmacy) return null;
  return (
    <div className="rounded-2xl border border-brand-200 bg-white p-3.5 shadow-[0_12px_28px_-26px_rgba(15,118,75,0.8)] sm:p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
          <Store className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-sm font-bold text-slate-900 sm:text-base">{copy.deliveryChoice.title}</h3>
            <span className={cn(
              "rounded-full px-2 py-1 text-[11px] font-semibold",
              changed ? "bg-amber-100 text-amber-900" : "bg-brand-50 text-brand-700",
            )}>{changed ? copy.deliveryChoice.priceUpdated : copy.deliveryChoice.priceKept}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {current.pharmacy.name}{current.pharmacy.address ? ` · ${current.pharmacy.address}` : ""}
          </p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs sm:grid-cols-3">
        <PriceMetric label={copy.deliveryChoice.goods} value={tenge(current.subtotal)} />
        <PriceMetric
          label={copy.deliveryChoice.delivery}
          value={current.delivery ? tenge(current.delivery.price) : "—"}
          hint={current.delivery ? checkoutText(copy.deliveryChoice.eta, { minutes: Math.round(current.delivery.eta) }) : undefined}
        />
        <PriceMetric label={copy.deliveryChoice.total} value={tenge(current.total)} strong />
      </dl>
      <p className="mt-2 text-xs leading-5 text-slate-500">{copy.deliveryChoice.priceHint}</p>
      {changed && (
        <div role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p>{checkoutText(copy.deliveryChoice.priceChange, {
            previous: tenge(catalogueSubtotal),
            current: tenge(current.subtotal),
          })}</p>
          {!priceAccepted && (
            <button
              type="button"
              onClick={onAcceptPrice}
              className="mt-3 min-h-11 w-full rounded-xl bg-amber-700 px-4 font-semibold text-white transition hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2"
            >
              {copy.deliveryChoice.acceptPrice}
            </button>
          )}
        </div>
      )}

      {quote && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={onFindCity}
            disabled={cityLoading}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-brand-500 px-3 py-2.5 text-sm font-semibold text-brand-700 transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
          >
            {cityLoading ? <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
            {cityLoading ? copy.deliveryChoice.searching : checkoutText(copy.deliveryChoice.search, { city: cityName })}
          </button>
          <p className="mt-1.5 text-center text-[11px] leading-4 text-slate-500">{copy.deliveryChoice.searchHint}</p>
        </div>
      )}

      {cityError && (
        <div role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p>{copy.deliveryChoice.searchFailed}</p>
          <button type="button" onClick={onFindCity} className="mt-2 min-h-9 font-semibold underline underline-offset-2">
            {copy.deliveryChoice.retry}
          </button>
        </div>
      )}

      {cityQuote && comparison?.isCheaper && (
        <div role="status" className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-emerald-950">{copy.deliveryChoice.betterFound}</p>
              <p className="mt-0.5 text-xs text-emerald-800">
                {cityQuote.pharmacy?.name}{cityQuote.pharmacy?.address ? ` · ${cityQuote.pharmacy.address}` : ""}
              </p>
            </div>
            <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white">
              {checkoutText(copy.deliveryChoice.savings, { amount: tenge(comparison.savings) })}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <PriceMetric label={copy.deliveryChoice.goods} value={tenge(cityQuote.subtotal)} />
            <PriceMetric label={copy.deliveryChoice.delivery} value={tenge(cityQuote.delivery?.price || 0)} />
            <PriceMetric label={copy.deliveryChoice.total} value={tenge(cityQuote.total)} strong />
          </dl>
          <button
            type="button"
            onClick={onApplyCity}
            className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
          >
            {copy.deliveryChoice.switch} <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      {cityQuote && comparison && !comparison.isCheaper && (
        <div role="status" className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-bold text-slate-900">{copy.deliveryChoice.currentBest}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{copy.deliveryChoice.currentBestHint}</p>
        </div>
      )}
    </div>
  );
}

function PriceMetric({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className={cn("mt-0.5 truncate tabular-nums text-slate-800", strong ? "font-display text-sm font-extrabold" : "font-semibold")}>{value}</dd>
      {hint && <span className="block text-[10px] text-slate-500">{hint}</span>}
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex min-w-0 justify-between gap-3">
      <dt className="min-w-0 text-slate-500">{label}</dt>
      <dd className={cn("shrink-0 text-right font-medium", accent ? "text-brand-700" : "text-slate-800")}>{value}</dd>
    </div>
  );
}

function CheckoutProgress({ copy }: { copy: CheckoutExtraCopy["progress"] }) {
  const steps = [copy.fulfillment, copy.contacts, copy.payment];
  const desktopSteps = [copy.fulfillment, copy.payment];
  return (
    <>
      <ol className="mt-4 grid grid-cols-3 gap-2 lg:hidden" aria-label={copy.aria}>
        {steps.map((step, index) => (
          <li key={step} className="flex min-w-0 items-center gap-2">
            <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold", index === 1 ? "bg-brand-600 text-white" : index < 1 ? "bg-brand-50 text-brand-700 ring-1 ring-brand-200" : "bg-white text-slate-500 ring-1 ring-slate-200")}>{index + 1}</span>
            <span className={cn("truncate text-xs font-semibold sm:text-sm", index === 1 ? "text-brand-800" : "text-slate-500")}>{step}</span>
          </li>
        ))}
      </ol>
      <ol className="mt-4 hidden grid-cols-2 gap-8 lg:grid" aria-label={copy.aria}>
        {desktopSteps.map((step, index) => (
          <li key={step} className="flex min-w-0 items-center gap-2">
            <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold", index === 1 ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-700 ring-1 ring-brand-200")}>{index + 1}</span>
            <span className={cn("truncate text-sm font-semibold", index === 1 ? "text-brand-800" : "text-slate-500")}>{step}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

function Field({ id, label, required, error, children }: { id: string; label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-slate-700">
        {label}{required && <span className="ml-1 text-rose-500" aria-hidden>*</span>}
      </label>
      {children}
      {error && <p id={`${id}-error`} role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-rose-600"><AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}</p>}
    </div>
  );
}

function Section({ title, desktopTitle, children }: { title: string; desktopTitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-[0_14px_36px_-30px_rgba(15,23,42,0.55)] sm:p-6">
      <h2 className="font-display text-lg font-bold text-slate-900">
        <span className={desktopTitle ? "lg:hidden" : undefined}>{title}</span>
        {desktopTitle && <span className="hidden lg:inline">{desktopTitle}</span>}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function RadioCard({ active, onClick, icon, title, text }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; text: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex min-h-20 items-start gap-3 rounded-xl border p-4 text-left transition", active ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500" : "border-slate-200 bg-slate-50/40 hover:border-slate-300")}>
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-500")}>{icon}</span>
      <span>
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="block text-xs text-slate-500">{text}</span>
      </span>
    </button>
  );
}

function Success({ order, code, delivery }: { order: string; code: string; delivery: "courier" | "pickup" | "post" }) {
  const { t } = useLang();
  const pickup = delivery === "pickup";
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
      <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-brand-100 text-brand-600"><CheckCircle2 className="h-11 w-11" /></span>
      <h1 className="mt-6 font-display text-3xl font-extrabold tracking-tight text-slate-900">{t("co.done.t")}</h1>
      <p className="mt-3 text-slate-500">{t("co.done.s1")} <span className="font-semibold text-slate-800">{order}</span>{t("co.done.s2")}</p>
      {code && (
        <div className="mx-auto mt-8 max-w-xs rounded-2xl border border-brand-200 bg-brand-50/60 p-5">
          <p className="text-sm font-semibold text-brand-800">{t("co.receiptTitle")}</p>
          <LocalQrCode value={`ASS-${order}-${code}`} alt="QR" />
          <p className="mt-3 text-xs text-slate-500">{t("co.receiptCode")}</p>
          <p className="font-display text-3xl font-extrabold tracking-[0.18em] text-brand-800">{code}</p>
          <p className="mt-2 text-xs text-brand-700">{t(pickup ? "co.receiptPickupHint" : "co.receiptDeliveryHint")}</p>
        </div>
      )}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/" className="inline-flex h-12 items-center rounded-xl border border-slate-200 px-6 font-semibold text-slate-700 transition hover:border-brand-300">{t("co.done.home")}</Link>
        <Link href="/account/orders" className="inline-flex h-12 items-center rounded-xl bg-brand-600 px-6 font-semibold text-white transition hover:bg-brand-700">{t("co.done.orders")}</Link>
      </div>
    </div>
  );
}
