import type { Lang } from "./dict";

export type PaymentCopy = {
  documentTitle: string;
  secureBadge: string;
  languageLabel: string;
  created: string;
  title: string;
  lead: string;
  amount: string;
  finalAmountHint: string;
  method: string;
  card: string;
  provider: string;
  securityTitle: string;
  securityBody: string;
  bankHint: string;
  pay: string;
  payShort: string;
  redirecting: string;
  orders: string;
  summary: string;
  order: string;
  products: string;
  total: string;
  progress: string;
  steps: {
    createdTitle: string;
    createdText: string;
    paymentTitle: string;
    paymentText: string;
    confirmationTitle: string;
    confirmationText: string;
  };
  loading: string;
  loadingHint: string;
  missingTitle: string;
  missingText: string;
  authTitle: string;
  authText: string;
  errorTitle: string;
  errorText: string;
  signIn: string;
  retry: string;
};

const ru: PaymentCopy = {
  documentTitle: "Безопасная оплата",
  secureBadge: "Защищённая оплата",
  languageLabel: "Язык страницы оплаты",
  created: "Заказ создан",
  title: "Безопасная оплата",
  lead: "Проверьте заказ и перейдите на защищённую страницу Kassa, чтобы ввести данные карты.",
  amount: "Стоимость товаров",
  finalAmountHint: "Итоговая сумма с учётом доставки, скидок и промокода будет показана на странице Kassa.",
  method: "Способ оплаты",
  card: "Банковская карта",
  provider: "Оплата на стороне Kassa",
  securityTitle: "Данные карты защищены",
  securityBody: "Номер карты и CVC вводятся только на защищённой странице Kassa и не сохраняются в «Аптеке со склада».",
  bankHint: "Банк может запросить подтверждение платежа.",
  pay: "Перейти к защищённой оплате",
  payShort: "Перейти к оплате",
  redirecting: "Открываем страницу оплаты…",
  orders: "Перейти к моим заказам",
  summary: "Ваш заказ",
  order: "Номер заказа",
  products: "Товары",
  total: "Стоимость товаров",
  progress: "Этапы оплаты",
  steps: {
    createdTitle: "Заказ создан",
    createdText: "Состав заказа передан для оплаты.",
    paymentTitle: "Оплата картой",
    paymentText: "Вы перейдёте на защищённую страницу Kassa.",
    confirmationTitle: "Подтверждение",
    confirmationText: "После оплаты статус появится в разделе «Мои заказы».",
  },
  loading: "Загружаем данные оплаты…",
  loadingHint: "Проверяем заказ и актуальную сумму.",
  missingTitle: "Платёжная сессия недоступна",
  missingText: "Ссылка устарела или заказ уже нельзя оплатить по ней. Проверьте статус в разделе «Мои заказы».",
  authTitle: "Нужно подтвердить вход",
  authText: "Платёжная сессия привязана к вашему номеру телефона. Войдите в аккаунт и попробуйте снова.",
  errorTitle: "Не удалось загрузить оплату",
  errorText: "Проверьте подключение к интернету и повторите попытку. Новый заказ создавать не нужно.",
  signIn: "Войти заново",
  retry: "Попробовать снова",
};

const kz: PaymentCopy = {
  documentTitle: "Қауіпсіз төлем",
  secureBadge: "Қорғалған төлем",
  languageLabel: "Төлем бетінің тілі",
  created: "Тапсырыс жасалды",
  title: "Қауіпсіз төлем",
  lead: "Тапсырысты тексеріп, карта деректерін енгізу үшін Kassa қорғалған бетіне өтіңіз.",
  amount: "Тауарлар құны",
  finalAmountHint: "Жеткізу, жеңілдіктер және промокод ескерілген қорытынды сома Kassa бетінде көрсетіледі.",
  method: "Төлем тәсілі",
  card: "Банк картасы",
  provider: "Төлем Kassa жағында",
  securityTitle: "Карта деректері қорғалған",
  securityBody: "Карта нөмірі мен CVC тек Kassa қорғалған бетінде енгізіледі және «Аптека со склада» сайтында сақталмайды.",
  bankHint: "Банк төлемді растауды сұрауы мүмкін.",
  pay: "Қорғалған төлемге өту",
  payShort: "Төлемге өту",
  redirecting: "Төлем бетін ашып жатырмыз…",
  orders: "Менің тапсырыстарыма өту",
  summary: "Сіздің тапсырысыңыз",
  order: "Тапсырыс нөмірі",
  products: "Тауарлар",
  total: "Тауарлар құны",
  progress: "Төлем кезеңдері",
  steps: {
    createdTitle: "Тапсырыс жасалды",
    createdText: "Тапсырыс құрамы төлемге жіберілді.",
    paymentTitle: "Картамен төлеу",
    paymentText: "Kassa қорғалған төлем бетіне өтесіз.",
    confirmationTitle: "Растау",
    confirmationText: "Төлемнен кейін мәртебе «Менің тапсырыстарым» бөлімінде көрінеді.",
  },
  loading: "Төлем деректерін жүктеп жатырмыз…",
  loadingHint: "Тапсырыс пен нақты соманы тексеріп жатырмыз.",
  missingTitle: "Төлем сессиясы қолжетімсіз",
  missingText: "Сілтеменің мерзімі өткен немесе тапсырысты бұл сілтемемен төлеу мүмкін емес. Мәртебені «Менің тапсырыстарым» бөлімінен тексеріңіз.",
  authTitle: "Кіруді растау қажет",
  authText: "Төлем сессиясы телефон нөміріңізге байланыстырылған. Аккаунтқа кіріп, қайта көріңіз.",
  errorTitle: "Төлем деректерін жүктеу мүмкін болмады",
  errorText: "Интернет байланысын тексеріп, қайталап көріңіз. Жаңа тапсырыс жасаудың қажеті жоқ.",
  signIn: "Қайта кіру",
  retry: "Қайта көру",
};

const en: PaymentCopy = {
  documentTitle: "Secure payment",
  secureBadge: "Secure payment",
  languageLabel: "Payment page language",
  created: "Order created",
  title: "Secure payment",
  lead: "Review the order, then continue to Kassa's secure page to enter your card details.",
  amount: "Items subtotal",
  finalAmountHint: "The final amount, including delivery, discounts and promo codes, will be shown on the Kassa page.",
  method: "Payment method",
  card: "Bank card",
  provider: "Payment processed by Kassa",
  securityTitle: "Your card details are protected",
  securityBody: "Your card number and CVC are entered only on Kassa's secure page and are not stored by Apteka so sklada.",
  bankHint: "Your bank may ask you to confirm the payment.",
  pay: "Continue to secure payment",
  payShort: "Continue to pay",
  redirecting: "Opening the payment page…",
  orders: "Go to my orders",
  summary: "Your order",
  order: "Order number",
  products: "Items",
  total: "Items subtotal",
  progress: "Payment steps",
  steps: {
    createdTitle: "Order created",
    createdText: "The order contents were sent for payment.",
    paymentTitle: "Pay by card",
    paymentText: "You will continue to Kassa's secure payment page.",
    confirmationTitle: "Confirmation",
    confirmationText: "After payment, the status will appear in My orders.",
  },
  loading: "Loading payment details…",
  loadingHint: "Checking the order and current amount.",
  missingTitle: "Payment session unavailable",
  missingText: "This link has expired or can no longer be used. Check the order status in My orders.",
  authTitle: "Please confirm your sign-in",
  authText: "This payment session is linked to your phone number. Sign in to your account and try again.",
  errorTitle: "We could not load the payment",
  errorText: "Check your internet connection and try again. You do not need to create a new order.",
  signIn: "Sign in again",
  retry: "Try again",
};

export const paymentCopy: Record<Lang, PaymentCopy> = { ru, kz, en };
