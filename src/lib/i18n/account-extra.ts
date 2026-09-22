import type { Lang } from "./dict";

type AccountExtraCopy = {
  locale: string;
  customerFallback: string;
  bonusUnavailable: string;
  bonusHistoryEmpty: string;
  removeAddress: string;
};

export const accountExtraCopy: Record<Lang, AccountExtraCopy> = {
  ru: {
    locale: "ru-RU",
    customerFallback: "Покупатель",
    bonusUnavailable: "Информация о бонусном счёте пока недоступна. Мы покажем её здесь после подключения программы лояльности Daribar.",
    bonusHistoryEmpty: "Пока нет операций по бонусному счёту.",
    removeAddress: "Удалить адрес",
  },
  kz: {
    locale: "kk-KZ",
    customerFallback: "Сатып алушы",
    bonusUnavailable: "Бонус шоты туралы ақпарат әзірше қолжетімсіз. Daribar адалдық бағдарламасы қосылғаннан кейін оны осы жерде көрсетеміз.",
    bonusHistoryEmpty: "Бонус шоты бойынша операциялар әзірге жоқ.",
    removeAddress: "Мекенжайды жою",
  },
  en: {
    locale: "en-US",
    customerFallback: "Customer",
    bonusUnavailable: "Bonus account information is not available yet. It will appear here once the Daribar loyalty program is connected.",
    bonusHistoryEmpty: "There are no bonus account transactions yet.",
    removeAddress: "Remove address",
  },
};
