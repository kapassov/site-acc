export type AiIntentId =
  | "cold"
  | "immunity"
  | "drySkin"
  | "sleep"
  | "headache"
  | "hair"
  | "sun"
  | "baby";

export type AiChipId = "cold" | "immunity" | "drySkin" | "sleep" | "headache" | "hair";

export type AiWhyId =
  | "generic"
  | "coldNasalRinse"
  | "coldVitaminD"
  | "coldOmega"
  | "immunityVitaminD"
  | "immunityOmega"
  | "drySkinThermal"
  | "drySkinSerum"
  | "drySkinCream"
  | "sleepMagnesium"
  | "sleepOmega"
  | "sleepVitaminD"
  | "headacheMagnesium"
  | "headacheOmega"
  | "hairOmega"
  | "hairVitaminD"
  | "sunSpf"
  | "sunVitaminD"
  | "sunMineral"
  | "babyCream"
  | "babyNasal"
  | "trendVitaminD"
  | "trendOmega"
  | "trendSkincare";

export interface AiPick {
  /** Product matching stays locale-independent: these keys target catalog data. */
  match: string[];
  whyId: AiWhyId;
}

export interface AiIntent {
  id: AiIntentId;
  picks: AiPick[];
}

/**
 * Product matching configuration. Keep `match` values tied to the live catalog;
 * only the stable rationale id is stored in chat state.
 */
export const aiIntents: AiIntent[] = [
  {
    id: "cold",
    picks: [
      { match: ["спрей", "аква", "нос", "морск", "sea", "spray"], whyId: "coldNasalRinse" },
      { match: ["d3", "витамин d", "витамин", "vitamin", "холекаль"], whyId: "coldVitaminD" },
      { match: ["омега", "omega", "рыбий", "fish"], whyId: "coldOmega" },
    ],
  },
  {
    id: "immunity",
    picks: [
      { match: ["d3", "витамин d", "витамин", "vitamin", "холекаль"], whyId: "immunityVitaminD" },
      { match: ["омега", "omega", "рыбий", "fish"], whyId: "immunityOmega" },
    ],
  },
  {
    id: "drySkin",
    picks: [
      { match: ["термальн", "thermal", "вода", "ива", "мист"], whyId: "drySkinThermal" },
      { match: ["сыворотк", "serum", "витамин c", "vit c", "selfie"], whyId: "drySkinSerum" },
      { match: ["крем", "cream", "увлажн", "бальзам"], whyId: "drySkinCream" },
    ],
  },
  {
    id: "sleep",
    picks: [
      { match: ["магний", "magn", "b6", "магне"], whyId: "sleepMagnesium" },
      { match: ["омега", "omega", "рыбий", "fish"], whyId: "sleepOmega" },
      { match: ["d3", "витамин d", "витамин", "vitamin"], whyId: "sleepVitaminD" },
    ],
  },
  {
    id: "headache",
    picks: [
      { match: ["магний", "magn", "b6", "магне"], whyId: "headacheMagnesium" },
      { match: ["омега", "omega", "рыбий", "fish"], whyId: "headacheOmega" },
    ],
  },
  {
    id: "hair",
    picks: [
      { match: ["омега", "omega", "рыбий", "fish"], whyId: "hairOmega" },
      { match: ["d3", "витамин d", "витамин", "vitamin"], whyId: "hairVitaminD" },
    ],
  },
  {
    id: "sun",
    picks: [
      { match: ["spf", "солнц", "sun", "anthelios", "санскрин"], whyId: "sunSpf" },
      { match: ["d3", "витамин d", "витамин", "vitamin"], whyId: "sunVitaminD" },
      { match: ["минераль", "mineral", "крем"], whyId: "sunMineral" },
    ],
  },
  {
    id: "baby",
    picks: [
      { match: ["baby", "детск", "малыш", "бэби", "беби", "крем"], whyId: "babyCream" },
      { match: ["aqualor", "аквалор", "капли", "нос", "спрей"], whyId: "babyNasal" },
    ],
  },
];

/** Trends keep the same product matching and carry only stable rationale ids. */
export const aiTrending: AiPick[] = [
  { match: ["d3", "витамин d", "витамин", "vitamin"], whyId: "trendVitaminD" },
  { match: ["омега", "omega", "рыбий", "fish"], whyId: "trendOmega" },
  { match: ["сыворотк", "serum", "витамин c", "крем"], whyId: "trendSkincare" },
];

/** Stable chip order; labels and inserted queries come from the active locale. */
export const aiChips: { id: AiChipId; intentId: AiIntentId }[] = [
  { id: "cold", intentId: "cold" },
  { id: "immunity", intentId: "immunity" },
  { id: "drySkin", intentId: "drySkin" },
  { id: "sleep", intentId: "sleep" },
  { id: "headache", intentId: "headache" },
  { id: "hair", intentId: "hair" },
];

export function getAiIntent(id: AiIntentId): AiIntent {
  const intent = aiIntents.find((item) => item.id === id);
  if (!intent) throw new Error(`Unknown AI intent: ${id}`);
  return intent;
}
