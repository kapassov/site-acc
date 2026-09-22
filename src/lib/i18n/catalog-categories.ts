import type { Lang } from "./dict.ts";

type CategoryNames = Record<Lang, string>;

const categoryNames: Record<string, CategoryNames> = {
  "lekarstva-i-bady": { ru: "Лекарства", kz: "Дәрі-дәрмектер", en: "Medicines" },
  bady: { ru: "БАДы", kz: "ББҚ", en: "Supplements" },
  gigiyena: { ru: "Гигиена", kz: "Гигиена", en: "Hygiene" },
  kosmetika: { ru: "Красота и уход", kz: "Сұлулық және күтім", en: "Beauty and care" },
  linzy: { ru: "Линзы", kz: "Линзалар", en: "Contact lenses" },
  "mama-i-malysh": { ru: "Мама и малыш", kz: "Ана мен бала", en: "Mother and baby" },
  "med-pribory-i-izdeliya": { ru: "Медицинские товары", kz: "Медициналық тауарлар", en: "Medical supplies" },
  medtehnika: { ru: "Медицинская техника", kz: "Медициналық техника", en: "Medical equipment" },
  "sport-i-fitnes": { ru: "Спорт и питание", kz: "Спорт және тамақтану", en: "Sports and nutrition" },
  intim: { ru: "Товары для взрослых", kz: "Ересектерге арналған тауарлар", en: "Adult products" },
  drugoe: { ru: "Другие", kz: "Басқа", en: "Other" },
  fitoterapiya: { ru: "Фитотерапия", kz: "Фитотерапия", en: "Herbal remedies" },
  "vitaminy-i-mineraly": { ru: "Витамины и минералы", kz: "Дәрумендер мен минералдар", en: "Vitamins and minerals" },
  "zagar-i-zashita-ot-solnca": { ru: "Солнцезащита", kz: "Күннен қорғану", en: "Sun protection" },

  "serdechno-sosudistie-preparati": { ru: "Сердце и сосуды", kz: "Жүрек және қан тамырлары", en: "Heart and circulation" },
  "ot-bakterii": { ru: "Противомикробные средства", kz: "Микробқа қарсы дәрілер", en: "Antimicrobials" },
  "pervaya-pomosch": { ru: "Первая помощь", kz: "Алғашқы көмек", en: "First aid" },
  "zheludochno-kishechnie": { ru: "Пищеварение", kz: "Ас қорыту", en: "Digestion" },
  "oporno-dvigatelnyi-apparat": { ru: "Суставы и мышцы", kz: "Буындар мен бұлшықеттер", en: "Joints and muscles" },
  "lor-organi": { ru: "Ухо, горло и нос", kz: "Құлақ, тамақ және мұрын", en: "Ear, nose and throat" },

  "bad-toniziruyuschie-i-obscheukreplyayuschie": { ru: "Тонус и укрепление организма", kz: "Ағзаны сергіту және нығайту", en: "Energy and general wellness" },
  "bad-zheludochno-kishechnie": { ru: "Для пищеварения", kz: "Ас қорытуға", en: "Digestive health" },
  "bad-pri-prostude": { ru: "При простуде", kz: "Суық тигенде", en: "Cold support" },
  "bad-dlya-sustavov": { ru: "Для суставов", kz: "Буындарға", en: "Joint support" },
  "bad-sedativnie": { ru: "Для сна и спокойствия", kz: "Ұйқы және тыныштық үшін", en: "Sleep and relaxation" },

  mikroelementi: { ru: "Микроэлементы", kz: "Микроэлементтер", en: "Trace elements" },
  polivitamini: { ru: "Поливитамины", kz: "Мультидәрумендер", en: "Multivitamins" },
  monovitamini: { ru: "Моновитамины", kz: "Жеке дәрумендер", en: "Single vitamins" },
  "ribii-zhir-i-omega": { ru: "Рыбий жир и Омега", kz: "Балық майы және Омега", en: "Fish oil and Omega" },
  "vitamini-dlya-detei": { ru: "Витамины для детей", kz: "Балаларға арналған дәрумендер", en: "Vitamins for children" },
  "vitamin-d": { ru: "Витамин D", kz: "D дәрумені", en: "Vitamin D" },

  "zubnie-pasti-poroshki-opolaskivateli": { ru: "Зубные пасты и ополаскиватели", kz: "Тіс пасталары мен шайғыштар", en: "Toothpaste and mouthwash" },
  "gigienicheskie-tovari": { ru: "Гигиенические товары", kz: "Гигиеналық тауарлар", en: "Personal hygiene" },
  "sredstva-zhenskoi-gigieni": { ru: "Женская гигиена", kz: "Әйелдер гигиенасы", en: "Feminine hygiene" },
  "zubnie-schetki-irrigatori-niti": { ru: "Щётки, ирригаторы и нити", kz: "Тіс щеткалары, ирригаторлар және жіптер", en: "Brushes, irrigators and floss" },
  "sredstva-ot-komarov": { ru: "Средства от комаров", kz: "Масалардан қорғайтын құралдар", en: "Mosquito protection" },

  "kosmetika-dlya-litsa-uhodovaya": { ru: "Уход за лицом", kz: "Бет күтімі", en: "Face care" },
  "kosmetika-dlya-tela": { ru: "Уход за телом", kz: "Дене күтімі", en: "Body care" },
  "kosmetika-dlya-litsa-ochischayuschaya": { ru: "Очищение лица", kz: "Бетті тазарту", en: "Facial cleansing" },
  "kosmetika-dlya-volos": { ru: "Уход за волосами", kz: "Шаш күтімі", en: "Hair care" },
  "solntsezaschitnie-sredstva": { ru: "Солнцезащитные средства", kz: "Күннен қорғайтын құралдар", en: "Sun care" },

  "detskoe-pitanie": { ru: "Детское питание", kz: "Балалар тағамы", en: "Baby food" },
  podguzniki: { ru: "Подгузники", kz: "Жөргектер", en: "Diapers" },
  "gigiena-malisha": { ru: "Гигиена малыша", kz: "Бала гигиенасы", en: "Baby hygiene" },
  "vse-dlya-kormleniya-rebenka": { ru: "Всё для кормления", kz: "Баланы тамақтандыруға арналған", en: "Feeding essentials" },
  "kormyaschim-i-beremennim": { ru: "Беременным и кормящим", kz: "Жүкті және бала емізетін аналарға", en: "Pregnancy and nursing" },

  "ortopedicheskie-izdeliya": { ru: "Ортопедические изделия", kz: "Ортопедиялық бұйымдар", en: "Orthopedic products" },
  "optika-i-linzi": { ru: "Оптика и линзы", kz: "Оптика және линзалар", en: "Optics and lenses" },
  "sredstva-po-uhodu-za-bol-nimi": { ru: "Уход за больными", kz: "Науқастарға күтім жасау", en: "Patient care" },
  "meditsinskaya-odezhda": { ru: "Медицинская одежда", kz: "Медициналық киім", en: "Medical clothing" },
  "shpritsi-kateteri-sistemi-dlya-infuzii": { ru: "Шприцы, катетеры и системы", kz: "Шприцтер, катетерлер және жүйелер", en: "Syringes, catheters and IV sets" },

  "ingalyatori-nebulaizeri": { ru: "Ингаляторы и небулайзеры", kz: "Ингаляторлар мен небулайзерлер", en: "Inhalers and nebulizers" },
  "tonometri-i-stetoskopi": { ru: "Тонометры и стетоскопы", kz: "Тонометрлер мен стетоскоптар", en: "Blood pressure monitors and stethoscopes" },
  "glyukometri-lantseti-test-poloski": { ru: "Глюкометры и тест-полоски", kz: "Глюкометрлер мен тест-жолақтар", en: "Glucose meters and test strips" },
  termometri: { ru: "Термометры", kz: "Термометрлер", en: "Thermometers" },
  "shagomeri-pul-soksimetri-vesi": { ru: "Пульсоксиметры и весы", kz: "Пульсоксиметрлер мен таразылар", en: "Pulse oximeters and scales" },

  "batonchiki-gematogen-konfeti": { ru: "Батончики и гематоген", kz: "Батончиктер мен гематоген", en: "Bars and hematogen" },
  "dieticheskoe-pitanie": { ru: "Диетическое питание", kz: "Диеталық тағам", en: "Diet foods" },
  napitki: { ru: "Напитки", kz: "Сусындар", en: "Drinks" },
  "lechebnie-smesi": { ru: "Лечебные смеси", kz: "Емдік қоспалар", en: "Medical nutrition formulas" },
  "diabeticheskoe-pitanie": { ru: "Диабетическое питание", kz: "Диабеттік тағам", en: "Diabetic foods" },

  "fitochai-v-komplekse": { ru: "Фиточаи в комплексе", kz: "Кешенді фитошайлар", en: "Herbal tea blends" },
  travi: { ru: "Лекарственные травы", kz: "Дәрілік шөптер", en: "Medicinal herbs" },
  "plodi-tsvetki-list-ya": { ru: "Плоды, цветки и листья", kz: "Жемістер, гүлдер және жапырақтар", en: "Fruits, flowers and leaves" },
  "fitochai-odnokomponentnie": { ru: "Однокомпонентные фиточаи", kz: "Бір компонентті фитошайлар", en: "Single-herb teas" },
  fitosbori: { ru: "Фитосборы", kz: "Шөп жинақтары", en: "Herbal collections" },
};

export function catalogCategoryName(handle: string, fallback: string, lang: Lang): string {
  return categoryNames[handle]?.[lang] ?? fallback;
}
