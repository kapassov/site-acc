export type CatalogDirectoryChild = {
  id: string;
  handle: string;
  name: string;
  daribarIds: readonly string[];
};

export type CatalogDirectoryGroup = {
  id: string;
  handle: string;
  name: string;
  icon: string;
  daribarIds: readonly string[];
  children: readonly CatalogDirectoryChild[];
};

/**
 * Two-level storefront directory backed by Daribar's public category tree.
 *
 * Keep the supplier IDs here instead of deriving links from labels: every link
 * must resolve to a real category and return products without keyword guessing.
 */
export const CATALOG_DIRECTORY: readonly CatalogDirectoryGroup[] = [
  {
    id: "directory-medicines",
    handle: "lekarstva-i-bady",
    name: "Лекарства",
    icon: "HeartPulse",
    daribarIds: ["9"],
    children: [
      { id: "directory-cardiovascular", handle: "serdechno-sosudistie-preparati", name: "Сердце и сосуды", daribarIds: ["62"] },
      { id: "directory-antibacterial", handle: "ot-bakterii", name: "Противомикробные средства", daribarIds: ["24"] },
      { id: "directory-first-aid", handle: "pervaya-pomosch", name: "Первая помощь", daribarIds: ["140"] },
      { id: "directory-digestion", handle: "zheludochno-kishechnie", name: "Пищеварение", daribarIds: ["60"] },
      { id: "directory-joints", handle: "oporno-dvigatelnyi-apparat", name: "Суставы и мышцы", daribarIds: ["44"] },
      { id: "directory-ent", handle: "lor-organi", name: "Ухо, горло и нос", daribarIds: ["38"] },
    ],
  },
  {
    id: "directory-supplements",
    handle: "bady",
    name: "БАДы",
    icon: "Pill",
    daribarIds: ["7"],
    children: [
      { id: "directory-tonic", handle: "bad-toniziruyuschie-i-obscheukreplyayuschie", name: "Тонус и укрепление организма", daribarIds: ["71"] },
      { id: "directory-supplement-digestion", handle: "bad-zheludochno-kishechnie", name: "Для пищеварения", daribarIds: ["169"] },
      { id: "directory-cold", handle: "bad-pri-prostude", name: "При простуде", daribarIds: ["12"] },
      { id: "directory-supplement-joints", handle: "bad-dlya-sustavov", name: "Для суставов", daribarIds: ["8"] },
      { id: "directory-calm", handle: "bad-sedativnie", name: "Для сна и спокойствия", daribarIds: ["73"] },
    ],
  },
  {
    id: "directory-vitamins",
    handle: "vitaminy-i-mineraly",
    name: "Витамины и минералы",
    icon: "Sun",
    daribarIds: ["27"],
    children: [
      { id: "directory-microelements", handle: "mikroelementi", name: "Микроэлементы", daribarIds: ["28"] },
      { id: "directory-multivitamins", handle: "polivitamini", name: "Поливитамины", daribarIds: ["70"] },
      { id: "directory-monovitamins", handle: "monovitamini", name: "Моновитамины", daribarIds: ["29"] },
      { id: "directory-omega", handle: "ribii-zhir-i-omega", name: "Рыбий жир и Омега", daribarIds: ["177"] },
      { id: "directory-kids-vitamins", handle: "vitamini-dlya-detei", name: "Витамины для детей", daribarIds: ["175"] },
      { id: "directory-vitamin-d", handle: "vitamin-d", name: "Витамин D", daribarIds: ["229"] },
    ],
  },
  {
    id: "directory-hygiene",
    handle: "gigiyena",
    name: "Гигиена",
    icon: "ShowerHead",
    daribarIds: ["16"],
    children: [
      { id: "directory-toothpaste", handle: "zubnie-pasti-poroshki-opolaskivateli", name: "Зубные пасты и ополаскиватели", daribarIds: ["17"] },
      { id: "directory-hygiene-goods", handle: "gigienicheskie-tovari", name: "Гигиенические товары", daribarIds: ["188"] },
      { id: "directory-womens-hygiene", handle: "sredstva-zhenskoi-gigieni", name: "Женская гигиена", daribarIds: ["58"] },
      { id: "directory-toothbrushes", handle: "zubnie-schetki-irrigatori-niti", name: "Щётки, ирригаторы и нити", daribarIds: ["277"] },
      { id: "directory-mosquito", handle: "sredstva-ot-komarov", name: "Средства от комаров", daribarIds: ["78"] },
    ],
  },
  {
    id: "directory-beauty",
    handle: "kosmetika",
    name: "Красота и уход",
    icon: "Sparkles",
    daribarIds: ["5"],
    children: [
      { id: "directory-face-care", handle: "kosmetika-dlya-litsa-uhodovaya", name: "Уход за лицом", daribarIds: ["180"] },
      { id: "directory-body-care", handle: "kosmetika-dlya-tela", name: "Уход за телом", daribarIds: ["184"] },
      { id: "directory-face-cleansing", handle: "kosmetika-dlya-litsa-ochischayuschaya", name: "Очищение лица", daribarIds: ["253"] },
      { id: "directory-hair-care", handle: "kosmetika-dlya-volos", name: "Уход за волосами", daribarIds: ["181"] },
      { id: "directory-sun-care", handle: "solntsezaschitnie-sredstva", name: "Солнцезащитные средства", daribarIds: ["92"] },
    ],
  },
  {
    id: "directory-mom-baby",
    handle: "mama-i-malysh",
    name: "Мама и малыш",
    icon: "Baby",
    daribarIds: ["22"],
    children: [
      { id: "directory-baby-food", handle: "detskoe-pitanie", name: "Детское питание", daribarIds: ["34"] },
      { id: "directory-diapers", handle: "podguzniki", name: "Подгузники", daribarIds: ["123"] },
      { id: "directory-baby-hygiene", handle: "gigiena-malisha", name: "Гигиена малыша", daribarIds: ["37"] },
      { id: "directory-feeding", handle: "vse-dlya-kormleniya-rebenka", name: "Всё для кормления", daribarIds: ["23"] },
      { id: "directory-pregnancy", handle: "kormyaschim-i-beremennim", name: "Беременным и кормящим", daribarIds: ["124"] },
    ],
  },
  {
    id: "directory-medical-goods",
    handle: "med-pribory-i-izdeliya",
    name: "Медицинские товары",
    icon: "Stethoscope",
    daribarIds: ["14"],
    children: [
      { id: "directory-orthopedic", handle: "ortopedicheskie-izdeliya", name: "Ортопедические изделия", daribarIds: ["203"] },
      { id: "directory-optics", handle: "optika-i-linzi", name: "Оптика и линзы", daribarIds: ["41"] },
      { id: "directory-patient-care", handle: "sredstva-po-uhodu-za-bol-nimi", name: "Уход за больными", daribarIds: ["204"] },
      { id: "directory-medical-clothes", handle: "meditsinskaya-odezhda", name: "Медицинская одежда", daribarIds: ["202"] },
      { id: "directory-injection", handle: "shpritsi-kateteri-sistemi-dlya-infuzii", name: "Шприцы, катетеры и системы", daribarIds: ["197"] },
    ],
  },
  {
    id: "directory-medical-equipment",
    handle: "medtehnika",
    name: "Медицинская техника",
    icon: "Activity",
    daribarIds: ["215"],
    children: [
      { id: "directory-nebulizers", handle: "ingalyatori-nebulaizeri", name: "Ингаляторы и небулайзеры", daribarIds: ["87"] },
      { id: "directory-tonometers", handle: "tonometri-i-stetoskopi", name: "Тонометры и стетоскопы", daribarIds: ["205"] },
      { id: "directory-glucometers", handle: "glyukometri-lantseti-test-poloski", name: "Глюкометры и тест-полоски", daribarIds: ["194"] },
      { id: "directory-thermometers", handle: "termometri", name: "Термометры", daribarIds: ["15"] },
      { id: "directory-pulse-oximeters", handle: "shagomeri-pul-soksimetri-vesi", name: "Пульсоксиметры и весы", daribarIds: ["275"] },
    ],
  },
  {
    id: "directory-sport",
    handle: "sport-i-fitnes",
    name: "Спорт и питание",
    icon: "Dumbbell",
    daribarIds: ["18"],
    children: [
      { id: "directory-bars", handle: "batonchiki-gematogen-konfeti", name: "Батончики и гематоген", daribarIds: ["19"] },
      { id: "directory-diet-food", handle: "dieticheskoe-pitanie", name: "Диетическое питание", daribarIds: ["54"] },
      { id: "directory-drinks", handle: "napitki", name: "Напитки", daribarIds: ["138"] },
      { id: "directory-medical-formulas", handle: "lechebnie-smesi", name: "Лечебные смеси", daribarIds: ["266"] },
      { id: "directory-diabetic-food", handle: "diabeticheskoe-pitanie", name: "Диабетическое питание", daribarIds: ["189"] },
    ],
  },
  {
    id: "directory-herbal",
    handle: "fitoterapiya",
    name: "Фитотерапия",
    icon: "Leaf",
    daribarIds: ["248"],
    children: [
      { id: "directory-herbal-tea", handle: "fitochai-v-komplekse", name: "Фиточаи в комплексе", daribarIds: ["250"] },
      { id: "directory-herbs", handle: "travi", name: "Лекарственные травы", daribarIds: ["67"] },
      { id: "directory-plants", handle: "plodi-tsvetki-list-ya", name: "Плоды, цветки и листья", daribarIds: ["247"] },
      { id: "directory-single-herbal-tea", handle: "fitochai-odnokomponentnie", name: "Однокомпонентные фиточаи", daribarIds: ["221"] },
      { id: "directory-herbal-blends", handle: "fitosbori", name: "Фитосборы", daribarIds: ["249"] },
    ],
  },
] as const;

export const CATALOG_DIRECTORY_CATEGORY_IDS: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(
    CATALOG_DIRECTORY.flatMap((group) => [
      [group.handle, group.daribarIds],
      ...group.children.map((child) => [child.handle, child.daribarIds] as const),
    ]),
  ),
);
