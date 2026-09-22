import type { Lang } from "./dict";

export type CartFulfillment = "courier" | "pickup";
export type CartAlertKey = "items" | "fulfillment" | "auth";

type FulfillmentCopy = {
  title: string;
  description: string;
  cardPrice: string;
  summaryPrice: string;
  eta: string;
};

type CartExtraCopy = {
  locale: string;
  back: string;
  fulfillmentTitle: string;
  migration: { title: string; text: string; dismiss: string };
  actions: {
    checkoutPickup: string;
    checkoutCourier: string;
    chooseProducts: string;
    chooseFulfillment: string;
  };
  alerts: Record<CartAlertKey, string>;
  fulfillment: Record<CartFulfillment, FulfillmentCopy>;
  summary: {
    pharmacyHours: string;
    deliveryFeePending: string;
    earnUpTo: (points: string) => string;
  };
};

export const cartExtraCopy: Record<Lang, CartExtraCopy> = {
  ru: {
    locale: "ru-RU",
    back: "Назад",
    fulfillmentTitle: "Способ получения",
    migration: {
      title: "Мы обновили каталог",
      text: "Товары из прежнего каталога не перенесены в новую корзину. Добавьте нужные товары заново, чтобы проверить актуальные цены и наличие.",
      dismiss: "Понятно",
    },
    actions: {
      checkoutPickup: "Оформить самовывоз",
      checkoutCourier: "Заказать доставку",
      chooseProducts: "Выберите товары",
      chooseFulfillment: "Выбрать способ получения",
    },
    alerts: {
      items: "Добавьте хотя бы один товар для оформления.",
      fulfillment: "Выберите самовывоз или доставку.",
      auth: "Подтвердите номер телефона — корзина сохранится, после входа продолжим оформление.",
    },
    fulfillment: {
      pickup: {
        title: "Самовывоз",
        description: "Заберите в аптеке через 30 минут",
        cardPrice: "Бесплатно",
        summaryPrice: "Бесплатно",
        eta: "Соберём заказ за 30 минут",
      },
      courier: {
        title: "Доставка",
        description: "Доставим за 30–60 минут",
        cardPrice: "от 800 ₸",
        summaryPrice: "Рассчитаем по адресу",
        eta: "Доставим за 30–60 минут",
      },
    },
    summary: {
      pharmacyHours: "В рабочее время аптеки",
      deliveryFeePending: "Стоимость доставки добавится после указания адреса.",
      earnUpTo: (points) => `Начислим до ${points} бонусов`,
    },
  },
  kz: {
    locale: "kk-KZ",
    back: "Артқа",
    fulfillmentTitle: "Алу тәсілі",
    migration: {
      title: "Каталог жаңартылды",
      text: "Бұрынғы каталогтағы тауарлар жаңа себетке көшірілген жоқ. Өзекті бағалар мен қолжетімділікті тексеру үшін қажетті тауарларды қайта қосыңыз.",
      dismiss: "Түсінікті",
    },
    actions: {
      checkoutPickup: "Өзі алып кетуді рәсімдеу",
      checkoutCourier: "Жеткізуге тапсырыс беру",
      chooseProducts: "Тауарларды таңдаңыз",
      chooseFulfillment: "Алу тәсілін таңдаңыз",
    },
    alerts: {
      items: "Рәсімдеу үшін кемінде бір тауар қосыңыз.",
      fulfillment: "Өзі алып кетуді немесе жеткізуді таңдаңыз.",
      auth: "Телефон нөміріңізді растаңыз — себет сақталады, кіргеннен кейін рәсімдеуді жалғастырамыз.",
    },
    fulfillment: {
      pickup: {
        title: "Өзі алып кету",
        description: "Дәріханадан 30 минуттан кейін алып кетіңіз",
        cardPrice: "Тегін",
        summaryPrice: "Тегін",
        eta: "Тапсырысты 30 минутта дайындаймыз",
      },
      courier: {
        title: "Жеткізу",
        description: "30–60 минутта жеткіземіз",
        cardPrice: "800 ₸-ден бастап",
        summaryPrice: "Мекенжай бойынша есептейміз",
        eta: "30–60 минутта жеткіземіз",
      },
    },
    summary: {
      pharmacyHours: "Дәріхананың жұмыс уақытында",
      deliveryFeePending: "Жеткізу құны мекенжай көрсетілгеннен кейін қосылады.",
      earnUpTo: (points) => `${points} бонусқа дейін есептейміз`,
    },
  },
  en: {
    locale: "en-US",
    back: "Back",
    fulfillmentTitle: "Fulfillment method",
    migration: {
      title: "We've updated the catalog",
      text: "Products from the previous catalog were not transferred to your new cart. Add the products again to check current prices and availability.",
      dismiss: "Got it",
    },
    actions: {
      checkoutPickup: "Arrange pickup",
      checkoutCourier: "Order delivery",
      chooseProducts: "Choose products",
      chooseFulfillment: "Choose a fulfillment method",
    },
    alerts: {
      items: "Add at least one product to continue.",
      fulfillment: "Choose pickup or delivery.",
      auth: "Confirm your phone number — your cart will be saved and checkout will continue after sign-in.",
    },
    fulfillment: {
      pickup: {
        title: "Pickup",
        description: "Collect from a pharmacy in 30 minutes",
        cardPrice: "Free",
        summaryPrice: "Free",
        eta: "We'll prepare your order in 30 minutes",
      },
      courier: {
        title: "Delivery",
        description: "Delivery in 30–60 minutes",
        cardPrice: "from 800 ₸",
        summaryPrice: "Calculated from your address",
        eta: "Delivery in 30–60 minutes",
      },
    },
    summary: {
      pharmacyHours: "During pharmacy opening hours",
      deliveryFeePending: "The delivery fee will be added after you enter an address.",
      earnUpTo: (points) => `Earn up to ${points} bonus points`,
    },
  },
};
