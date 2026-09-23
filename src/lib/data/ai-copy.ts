import type { Lang } from "@/lib/i18n/dict";
import { aiIntents, type AiChipId, type AiIntent, type AiIntentId, type AiWhyId } from "./ai.ts";

interface AiIntentCopy {
  /** Keywords used to recognise a query written in the active language. */
  keys: string[];
  intro: string;
  warn?: string;
}

interface AiLocaleCopy {
  userAvatar: string;
  send: string;
  chips: Record<AiChipId, { label: string; query: string }>;
  intents: Record<AiIntentId, AiIntentCopy>;
  why: Record<AiWhyId, string>;
}

export const aiCopy: Record<Lang, AiLocaleCopy> = {
  ru: {
    userAvatar: "Я",
    send: "Отправить вопрос",
    chips: {
      cold: { label: "Простуда", query: "Простуда и насморк, болит горло" },
      immunity: { label: "Иммунитет", query: "Чувствую усталость, низкий иммунитет, осень" },
      drySkin: { label: "Сухая кожа", query: "Сухая чувствительная кожа лица, шелушение" },
      sleep: { label: "Сон и стресс", query: "Плохо сплю, стресс, тревога вечером" },
      headache: { label: "Голова", query: "Болит голова, давление, мигрень" },
      hair: { label: "Волосы", query: "Подобрать витамины для волос и ногтей" },
    },
    intents: {
      cold: {
        keys: ["простуд", "грипп", "насморк", "горло", "орви", "температ", "чих", "кашел"],
        intro: "Похоже на простуду или ОРВИ в начальной фазе. В первые 2–3 дня важна поддержка иммунитета, увлажнение слизистых и снятие симптомов. Подобрала базовый набор. Если температура держится больше 3 дней — обязательно к врачу.",
      },
      immunity: {
        keys: ["иммунитет", "усталост", "упадок", "осень", "зима", "энерг", "слабость"],
        intro: "Сезонное снижение иммунитета — типичная история к осени. Чаще всего корень — дефицит витамина D, омега-3 и нехватка восстановления. Курс на 2 месяца плюс режим сна обычно даёт заметный результат.",
      },
      drySkin: {
        keys: ["сух", "шелуш", "стянут", "чувствительн", "раздражени", "кожа", "кож лица"],
        intro: "Признаки нарушенного липидного барьера: коже не хватает увлажнения и восстановления. Стратегия — мягкое очищение, удерживающая влагу сыворотка и термальная вода. Избегайте кислот и спиртовых тоников 2–3 недели.",
      },
      sleep: {
        keys: ["сон", "бессонниц", "стресс", "тревог", "засыпан", "нерв", "спать"],
        intro: "Нарушения сна часто связаны с дефицитом магния, омега-3 и низким уровнем витамина D. Рекомендую поддержку нервной системы плюс вечерний ритуал. При сильной тревоге — обратитесь к специалисту.",
      },
      headache: {
        keys: ["голов", "мигрен", "давлен", "висок"],
        intro: "Головная боль — частый симптом множества причин: обезвоживание, недосып, низкий магний, давление. При повторяющихся приступах обязательно к терапевту. Из аптечных полок могу предложить базовую поддержку.",
        warn: "При острой или регулярной боли обратитесь к врачу — это может быть симптомом серьёзного состояния.",
      },
      hair: {
        keys: ["волос", "ногт", "выпаден", "ломк"],
        intro: "Состояние волос и ногтей напрямую отражает дефициты: омега-3, витамин D, цинк. Курс 2–3 месяца плюс мягкий уход обычно даёт видимый результат к третьему месяцу.",
      },
      sun: {
        keys: ["витамин d", "d3", "солнц", "spf", "загар", "пигмент"],
        intro: "Защита от солнца — главная anti-age-привычка, а витамин D в наших широтах в дефиците с октября по март. Подобрала и защиту, и поддержку изнутри.",
      },
      baby: {
        keys: ["ребен", "детск", "малыш", "грудн", "подгузник"],
        intro: "Для малышей — только мягкие, проверенные средства. Подобрала базовый уход для самых маленьких. При любых тревожных симптомах у ребёнка — к педиатру.",
      },
    },
    why: {
      generic: "Популярный выбор в этой категории — часто берут по похожему запросу.",
      coldNasalRinse: "Промывание морской водой увлажняет слизистую и облегчает носовое дыхание",
      coldVitaminD: "Витамин D укрепляет иммунный ответ — особенно при дефиците осенью и зимой",
      coldOmega: "Омега-3 уменьшает воспаление слизистых и ускоряет восстановление",
      immunityVitaminD: "Витамин D — рабочая поддержка иммунитета для жителей Алматы зимой, курс 2–3 месяца",
      immunityOmega: "Омега-3 EPA/DHA снижает хроническое воспаление и повышает энергию",
      drySkinThermal: "Термальная вода успокаивает и восстанавливает защитный барьер",
      drySkinSerum: "Сыворотка с витамином C регенерирует и выравнивает тон",
      drySkinCream: "Интенсивный крем для сухой кожи удерживает влагу надолго",
      sleepMagnesium: "Магний + B6 поддерживает нервную систему и расслабление перед сном",
      sleepOmega: "Омега-3 стабилизирует настроение и работу нервной системы",
      sleepVitaminD: "Низкий уровень D связан с тревожностью и нарушением сна",
      headacheMagnesium: "Дефицит магния — частая причина головной боли и спазмов",
      headacheOmega: "Омега-3 уменьшает частоту приступов по данным исследований",
      hairOmega: "Омега-3 укрепляет фолликулы и улучшает структуру ногтей",
      hairVitaminD: "Витамин D критичен для роста волос, особенно при выпадении",
      sunSpf: "SPF 50+ защищает от фотостарения и пигментации",
      sunVitaminD: "Витамин D компенсирует дефицит солнца — рабочая поддержка",
      sunMineral: "Минеральный уход подходит чувствительной коже",
      babyCream: "Детский крем успокаивает и защищает нежную кожу",
      babyNasal: "Мягко очищает носик малыша с первых дней жизни",
      trendVitaminD: "#1 запрос недели — поддержка иммунитета при зимнем дефиците",
      trendOmega: "+47% к запросам за сезон — иммунитет и сосуды",
      trendSkincare: "Топ ухода — восстановление сухой и чувствительной кожи",
    },
  },
  kz: {
    userAvatar: "Мен",
    send: "Сұрақты жіберу",
    chips: {
      cold: { label: "Суық тию", query: "Суық тиіп, мұрын бітелді, тамағым ауырады" },
      immunity: { label: "Иммунитет", query: "Шаршадым, иммунитетім төмен, күз мезгілі" },
      drySkin: { label: "Құрғақ тері", query: "Бет терісі құрғақ әрі сезімтал, қабыршақтанады" },
      sleep: { label: "Ұйқы және стресс", query: "Нашар ұйықтаймын, кешке стресс пен мазасыздық бар" },
      headache: { label: "Бас ауруы", query: "Басым ауырады, қысым, мигрень" },
      hair: { label: "Шаш", query: "Шаш пен тырнаққа арналған дәрумендер таңдау" },
    },
    intents: {
      cold: {
        keys: ["суық", "тұмау", "мұрын", "тамақ", "жөтел", "қызу", "түшкір"],
        intro: "Бұл суық тиюдің немесе ЖРВИ-дің бастапқы кезеңіне ұқсайды. Алғашқы 2–3 күнде иммунитетті қолдау, шырышты қабықты ылғалдандыру және симптомдарды жеңілдету маңызды. Негізгі жинақты таңдадым. Дене қызуы 3 күннен артық сақталса, міндетті түрде дәрігерге көрініңіз.",
      },
      immunity: {
        keys: ["иммунитет", "шарша", "әлсіз", "күз", "қыста", "қуат"],
        intro: "Иммунитеттің маусымдық төмендеуі күзде жиі кездеседі. Көбіне оған D дәрумені мен омега-3 тапшылығы және жеткіліксіз демалыс әсер етеді. Екі айлық курс пен қалыпты ұйқы режимі әдетте байқаларлық нәтиже береді.",
      },
      drySkin: {
        keys: ["құрғақ", "қабыршақ", "тартыл", "сезімтал", "тітіркен", "тері"],
        intro: "Бұл липидті тосқауылдың бұзылу белгілеріне ұқсайды: теріге ылғал мен қалпына келу жетіспейді. Жұмсақ тазарту, ылғалды ұстайтын сарысу және термалды су қолданыңыз. Қышқылдар мен спиртті тониктерді 2–3 аптаға тоқтата тұрған дұрыс.",
      },
      sleep: {
        keys: ["ұйқы", "ұйық", "стресс", "мазасыз", "жүйке"],
        intro: "Ұйқының бұзылуы магний мен омега-3 тапшылығына және D дәруменінің төмен деңгейіне байланысты болуы мүмкін. Жүйке жүйесін қолдауды және кешкі тыныштандыратын әдетті ұсынамын. Қатты мазасыздық болса, маманға жүгініңіз.",
      },
      headache: {
        keys: ["басым", "бас ауру", "мигрень", "қысым", "самай"],
        intro: "Бас ауруының себептері көп болуы мүмкін: сусыздану, ұйқының қанбауы, магнийдің төмен деңгейі немесе қан қысымы. Ұстама қайталанса, терапевтке көрініңіз. Дәріхана ассортиментінен негізгі қолдау құралдарын ұсына аламын.",
        warn: "Қатты немесе тұрақты бас ауруы кезінде дәрігерге жүгініңіз — бұл күрделі жағдайдың белгісі болуы мүмкін.",
      },
      hair: {
        keys: ["шаш", "тырнақ", "түсу", "сынғыш"],
        intro: "Шаш пен тырнақтың күйі омега-3, D дәрумені және мырыш тапшылығын көрсетуі мүмкін. 2–3 айлық курс пен жұмсақ күтім әдетте үшінші айға қарай байқаларлық нәтиже береді.",
      },
      sun: {
        keys: ["d дәрумен", "d3", "күн", "spf", "күнге күю", "пигмент"],
        intro: "Күннен қорғану — басты anti-age әдеті, ал біздің ендіктерде қазаннан наурызға дейін D дәрумені жиі тапшы болады. Сыртқы қорғаныс пен ағзаны іштен қолдауға арналған өнімдерді таңдадым.",
      },
      baby: {
        keys: ["бала", "нәресте", "сәби", "жөргек"],
        intro: "Сәбилерге тек жұмсақ әрі тексерілген құралдар қажет. Ең кішкентайларға арналған негізгі күтімді таңдадым. Балада алаңдататын симптомдар болса, педиатрға жүгініңіз.",
      },
    },
    why: {
      generic: "Осы санаттағы танымал таңдау — ұқсас сұраулар бойынша жиі сатып алынады.",
      coldNasalRinse: "Теңіз суымен шаю шырышты қабықты ылғалдандырып, мұрынмен тыныстауды жеңілдетеді",
      coldVitaminD: "D дәрумені иммундық жауапты қолдайды, әсіресе күз бен қыста тапшылық кезінде",
      coldOmega: "Омега-3 шырышты қабықтың қабынуын азайтып, қалпына келуді жылдамдатады",
      immunityVitaminD: "D дәрумені Алматы тұрғындарының қысқы иммунитетін қолдайды; ұсынылатын курс — 2–3 ай",
      immunityOmega: "Омега-3 EPA/DHA созылмалы қабынуды азайтып, қуатты арттыруға көмектеседі",
      drySkinThermal: "Термалды су теріні тыныштандырып, қорғаныс тосқауылын қалпына келтіреді",
      drySkinSerum: "C дәрумені бар сарысу қалпына келуді қолдап, тері реңін тегістейді",
      drySkinCream: "Құрғақ теріге арналған қарқынды крем ылғалды ұзақ сақтайды",
      sleepMagnesium: "Магний + B6 жүйке жүйесін қолдап, ұйқы алдында босаңсуға көмектеседі",
      sleepOmega: "Омега-3 көңіл күй мен жүйке жүйесінің жұмысын тұрақтандыруға көмектеседі",
      sleepVitaminD: "D дәруменінің төмен деңгейі мазасыздық пен ұйқының бұзылуына байланысты болуы мүмкін",
      headacheMagnesium: "Магний тапшылығы бас ауруы мен түйілудің жиі себептерінің бірі",
      headacheOmega: "Зерттеулер бойынша омега-3 ұстамалардың жиілігін азайтуға көмектесуі мүмкін",
      hairOmega: "Омега-3 шаш фолликулдарын нығайтып, тырнақ құрылымын жақсартуға көмектеседі",
      hairVitaminD: "D дәрумені шаштың өсуі үшін, әсіресе шаш түскен кезде, маңызды",
      sunSpf: "SPF 50+ фотокартаю мен пигментациядан қорғайды",
      sunVitaminD: "D дәрумені күн сәулесінің тапшылығын толықтыруға көмектеседі",
      sunMineral: "Минералды күтім сезімтал теріге сай келеді",
      babyCream: "Балалар кремі нәзік теріні тыныштандырып, қорғайды",
      babyNasal: "Нәрестенің мұрнын өмірінің алғашқы күндерінен бастап жұмсақ тазартады",
      trendVitaminD: "Аптаның №1 сұрауы — қысқы тапшылық кезінде иммунитетті қолдау",
      trendOmega: "Маусым ішінде сұраулар +47% өсті — иммунитет пен қан тамырларын қолдау",
      trendSkincare: "Күтім көшбасшысы — құрғақ әрі сезімтал теріні қалпына келтіру",
    },
  },
  en: {
    userAvatar: "Me",
    send: "Send question",
    chips: {
      cold: { label: "Cold & flu", query: "I have a cold, a runny nose and a sore throat" },
      immunity: { label: "Immunity", query: "I feel tired and my immunity is low this autumn" },
      drySkin: { label: "Dry skin", query: "My facial skin is dry, sensitive and flaky" },
      sleep: { label: "Sleep & stress", query: "I sleep poorly and feel stressed and anxious in the evening" },
      headache: { label: "Headache", query: "I have a headache, pressure and migraine" },
      hair: { label: "Hair", query: "Help me choose vitamins for hair and nails" },
    },
    intents: {
      cold: {
        keys: ["cold", "flu", "runny nose", "sore throat", "fever", "sneez", "cough"],
        intro: "This sounds like an early-stage cold or viral respiratory infection. During the first 2–3 days, it is important to support the immune system, keep the mucous membranes hydrated and relieve symptoms. I have selected a basic set. If the fever lasts longer than 3 days, please see a doctor.",
      },
      immunity: {
        keys: ["immunity", "tired", "fatigue", "autumn", "winter", "energy", "weak"],
        intro: "A seasonal dip in immunity is common in autumn. Vitamin D or omega-3 deficiency and insufficient recovery are frequent contributors. A two-month course combined with a regular sleep schedule usually produces a noticeable result.",
      },
      drySkin: {
        keys: ["dry", "flaky", "tight", "sensitive", "irritat", "skin"],
        intro: "These are signs of a disrupted lipid barrier: the skin needs hydration and repair. Use gentle cleansing, a moisture-retaining serum and thermal water. Avoid acids and alcohol-based toners for 2–3 weeks.",
      },
      sleep: {
        keys: ["sleep", "insomnia", "stress", "anxious", "anxiety", "nervous"],
        intro: "Sleep problems can be associated with magnesium or omega-3 deficiency and low vitamin D. I recommend nervous-system support and a calming evening routine. If anxiety is severe, please consult a specialist.",
      },
      headache: {
        keys: ["head", "migraine", "pressure", "temple"],
        intro: "Headaches have many possible causes, including dehydration, poor sleep, low magnesium and blood pressure. See a doctor if attacks recur. I can suggest basic supportive products from the pharmacy range.",
        warn: "For a severe or recurring headache, see a doctor — it may be a symptom of a serious condition.",
      },
      hair: {
        keys: ["hair", "nail", "hair loss", "brittle"],
        intro: "Hair and nail condition may reflect omega-3, vitamin D or zinc deficiencies. A 2–3 month course plus gentle care usually gives a visible result by the third month.",
      },
      sun: {
        keys: ["vitamin d", "d3", "sun", "spf", "tan", "pigment"],
        intro: "Sun protection is the most important anti-age habit, while vitamin D is often deficient at our latitude from October through March. I have selected both external protection and support from within.",
      },
      baby: {
        keys: ["child", "children", "baby", "infant", "diaper"],
        intro: "Babies need only gentle, trusted products. I have selected basic care for the youngest children. See a pediatrician if your child has any worrying symptoms.",
      },
    },
    why: {
      generic: "A popular choice in this category, often selected for similar requests.",
      coldNasalRinse: "A sea-water rinse moisturises the nasal lining and makes breathing easier",
      coldVitaminD: "Vitamin D supports the immune response, especially during autumn and winter deficiency",
      coldOmega: "Omega-3 may reduce inflammation of the mucous membranes and support recovery",
      immunityVitaminD: "Vitamin D supports immunity during an Almaty winter; a typical course is 2–3 months",
      immunityOmega: "Omega-3 EPA/DHA may reduce chronic inflammation and support energy levels",
      drySkinThermal: "Thermal water soothes the skin and helps restore its protective barrier",
      drySkinSerum: "A vitamin C serum supports regeneration and evens the skin tone",
      drySkinCream: "An intensive cream for dry skin helps retain moisture for longer",
      sleepMagnesium: "Magnesium + B6 supports the nervous system and relaxation before sleep",
      sleepOmega: "Omega-3 supports stable mood and normal nervous-system function",
      sleepVitaminD: "Low vitamin D may be associated with anxiety and disrupted sleep",
      headacheMagnesium: "Magnesium deficiency is a common contributor to headaches and muscle spasms",
      headacheOmega: "Research suggests omega-3 may help reduce the frequency of attacks",
      hairOmega: "Omega-3 supports hair follicles and may improve nail structure",
      hairVitaminD: "Vitamin D is important for hair growth, particularly when hair is shedding",
      sunSpf: "SPF 50+ protects against photoageing and pigmentation",
      sunVitaminD: "Vitamin D helps compensate for limited sunlight exposure",
      sunMineral: "Mineral skincare is suitable for sensitive skin",
      babyCream: "Baby cream soothes and protects delicate skin",
      babyNasal: "Gently cleans a baby's nose from the first days of life",
      trendVitaminD: "This week's #1 request — immune support during winter vitamin D deficiency",
      trendOmega: "Seasonal requests are up 47% — support for immunity and cardiovascular health",
      trendSkincare: "Top skincare concern — restoring dry and sensitive skin",
    },
  },
};

export function findAiIntent(query: string, lang: Lang): AiIntent | null {
  const normalized = query.toLocaleLowerCase(lang === "kz" ? "kk-KZ" : lang);
  return aiIntents.find((intent) => (
    aiCopy[lang].intents[intent.id].keys.some((key) => normalized.includes(key))
  )) ?? null;
}
