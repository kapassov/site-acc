import { createHash } from "node:crypto";
import { daribarJson, DaribarHttpError } from "./client.ts";
import { daribarApiOrigin, daribarNetworkCode, daribarServiceToken } from "./config.ts";

export type DaribarPharmacyDto = {
  sourceCode?: string;
  name: string;
  address: string;
  city: string;
  lat: number;
  lon: number;
  hours: string;
};

type UnknownRecord = Record<string, unknown>;

const CITY = /^[\p{L}\p{M} .'-]{1,100}$/u;
const SOURCE_CODE = /^[A-Za-z0-9._:-]{1,100}$/;
const MAX_DIRECTORY_ENTRIES = 10_000;
const MAX_DIRECTORY_CITIES = 64;
const ALL_CONCURRENCY = 4;
const ALL_DEADLINE_MS = 10_000;
const ALL_CACHE_MS = 90_000;
const MAX_ALL_CACHE_ENTRIES = 4;
const allCache = new Map<string, { pharmacies: DaribarPharmacyDto[]; expiresAt: number }>();
const allInflight = new Map<string, Promise<DaribarPharmacyDto[]>>();

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function finiteCoordinate(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function sourcesFromPayload(payload: unknown): unknown[] {
  const root = record(payload);
  if (!root) return [];
  if (Array.isArray(root.sources)) return root.sources;
  const data = record(root.data);
  return data && Array.isArray(data.sources) ? data.sources : [];
}

export function mapDaribarPharmacies(
  payload: unknown,
  networkCode: string,
  requestedCity = "",
  options: { onlyConfirmedActive?: boolean } = {},
): DaribarPharmacyDto[] {
  const expectedNetwork = cleanText(networkCode, 100).toLocaleLowerCase("ru");
  if (!expectedNetwork) return [];
  const cityFilter = cleanText(requestedCity, 100).toLocaleLowerCase("ru");
  const seen = new Set<string>();
  const pharmacies: DaribarPharmacyDto[] = [];

  for (const entry of sourcesFromPayload(payload).slice(0, 10_000)) {
    const source = record(entry);
    if (!source || source.active === false) continue;
    if (options.onlyConfirmedActive && source.active !== true) continue;
    const sourceNetwork = cleanText(source.network_code, 100).toLocaleLowerCase("ru");
    if (expectedNetwork && sourceNetwork !== expectedNetwork) continue;

    const sourceCode = cleanText(source.pharmacy_code, 100);
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(sourceCode) || seen.has(sourceCode)) continue;
    const location = record(source.location);
    const lat = finiteCoordinate(location?.lat, -90, 90);
    const lon = finiteCoordinate(location?.lon, -180, 180);
    const address = cleanText(location?.address, 512);
    const city = cleanText(source.city, 100) || cleanText(requestedCity, 100);
    if (lat == null || lon == null || !address || !city) continue;
    if (lat === 0 && lon === 0) continue;
    if (cityFilter && city.toLocaleLowerCase("ru") !== cityFilter) continue;

    seen.add(sourceCode);
    pharmacies.push({
      sourceCode,
      name: cleanText(source.name, 200) || "Аптека со склада",
      address,
      city,
      lat,
      lon,
      hours: cleanText(source.opening_hours, 200) || "График уточняется",
    });
  }
  return pharmacies;
}

function invalidDirectory(): DaribarHttpError {
  return new DaribarHttpError(502, "daribar_pharmacy_directory_invalid");
}

function cityKey(city: string): string {
  return city.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
}

/** Use the network directory only for cities and confirmed source identities. */
function networkDirectory(payload: unknown, networkCode: string): {
  cities: string[];
  allowed: Map<string, string>;
} {
  const root = record(payload);
  if (!root || !Array.isArray(root.result) || root.result.length > MAX_DIRECTORY_ENTRIES) {
    throw invalidDirectory();
  }
  const expectedNetwork = networkCode.toLocaleLowerCase("ru");
  const cities = new Map<string, string>();
  const identities = new Map<string, { city: string; eligible: boolean }>();
  for (const entry of root.result) {
    const source = record(entry);
    if (!source || typeof source.network_code !== "string" || !source.network_code.trim()) {
      throw invalidDirectory();
    }
    if (source.network_code.trim().toLocaleLowerCase("ru") !== expectedNetwork) continue;
    const city = typeof source.city === "string" ? source.city.trim().replace(/\s+/g, " ") : "";
    const code = typeof source.code === "string" ? source.code.trim() : "";
    if (!CITY.test(city) || !/\p{L}/u.test(city) || !SOURCE_CODE.test(code)) throw invalidDirectory();
    const key = cityKey(city);
    cities.set(key, cities.get(key) ?? city);
    if (cities.size > MAX_DIRECTORY_CITIES) throw invalidDirectory();
    // Emdel can say active=true for a source that the live directory disables.
    // Automatic selection requires both statuses to be explicitly confirmed.
    const eligible = source.active === true && source.disabled === false;
    const previous = identities.get(code);
    if (previous && previous.city !== key) throw invalidDirectory();
    identities.set(code, { city: key, eligible: eligible && (!previous || previous.eligible) });
  }
  return {
    cities: [...cities.values()],
    allowed: new Map([...identities].filter(([, identity]) => identity.eligible).map(([code, identity]) => [code, identity.city])),
  };
}

function confirmedCityPharmacies(
  payload: unknown,
  networkCode: string,
  city: string,
  allowed: Map<string, string>,
): DaribarPharmacyDto[] {
  const root = record(payload);
  const sources = Array.isArray(root?.sources) ? root.sources : record(root?.data)?.sources;
  if (!Array.isArray(sources) || sources.length > MAX_DIRECTORY_ENTRIES || sources.some((entry) => !record(entry))) {
    throw invalidDirectory();
  }
  return mapDaribarPharmacies(payload, networkCode, city, { onlyConfirmedActive: true })
    .filter((point) => point.sourceCode && allowed.get(point.sourceCode) === cityKey(point.city));
}

async function fetchAllPharmacies(networkCode: string): Promise<DaribarPharmacyDto[]> {
  const deadline = Date.now() + ALL_DEADLINE_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = () => new DaribarHttpError(504, "daribar_pharmacy_directory_timeout");
  const requestBudget = () => {
    const remaining = deadline - Date.now();
    // daribarJson's minimum is one second: do not start work that could outlive
    // the total budget by being rounded up to that minimum.
    if (stopped || remaining < 1_000) throw timeout();
    return Math.min(8_000, remaining);
  };
  const collect = async () => {
    const directoryPayload = await daribarJson<unknown>("/api/v1/sources", {
      query: { network_code: networkCode },
      timeoutMs: requestBudget(),
      maxBytes: 4 * 1024 * 1024,
    });
    if (stopped || Date.now() >= deadline) throw timeout();
    const directory = networkDirectory(directoryPayload, networkCode);
    const results: DaribarPharmacyDto[][] = Array.from({ length: directory.cities.length }, () => []);
    let next = 0;
    const worker = async () => {
      while (!stopped && next < directory.cities.length) {
        const index = next++;
        const city = directory.cities[index];
        try {
          const payload = await daribarJson<unknown>("/api/v1/emdel/pharmacies/all", {
            query: { city },
            timeoutMs: requestBudget(),
            maxBytes: 4 * 1024 * 1024,
          });
          if (stopped || Date.now() >= deadline) throw timeout();
          results[index] = confirmedCityPharmacies(payload, networkCode, city, directory.allowed);
        } catch (error) {
          stopped = true;
          throw error;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(ALL_CONCURRENCY, directory.cities.length) }, worker));
    if (stopped || Date.now() >= deadline) throw timeout();
    return [...new Map(results.flat().map((point) => [point.sourceCode!, point])).values()];
  };
  try {
    // A separate deadline also prevents late/aborted responses from publishing
    // a partial or over-budget result. In-flight HTTP calls have this same cap.
    return await Promise.race([
      collect(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { stopped = true; reject(timeout()); }, ALL_DEADLINE_MS);
      }),
    ]);
  } finally {
    stopped = true;
    if (timer) clearTimeout(timer);
  }
}

async function allDaribarPharmacies(): Promise<DaribarPharmacyDto[]> {
  const networkCode = daribarNetworkCode().trim();
  if (!networkCode) throw invalidDirectory();
  const key = createHash("sha256").update(JSON.stringify([
    daribarApiOrigin().origin, networkCode.toLocaleLowerCase("ru"), daribarServiceToken(),
  ])).digest("hex");
  const cached = allCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.pharmacies.map((point) => ({ ...point }));
  allCache.delete(key);
  let pending = allInflight.get(key);
  if (!pending) {
    pending = fetchAllPharmacies(networkCode).then((pharmacies) => {
      // Empty, failed or partial lookups must be retried, not pinned by a cache.
      if (pharmacies.length) {
        while (allCache.size >= MAX_ALL_CACHE_ENTRIES) allCache.delete(allCache.keys().next().value!);
        allCache.set(key, { pharmacies, expiresAt: Date.now() + ALL_CACHE_MS });
      }
      return pharmacies;
    }).finally(() => { allInflight.delete(key); });
    allInflight.set(key, pending);
  }
  return (await pending).map((point) => ({ ...point }));
}

export async function getDaribarPharmacies(city?: string): Promise<DaribarPharmacyDto[]> {
  const normalizedCity = city?.trim();
  if (!normalizedCity) return allDaribarPharmacies();
  const payload = await daribarJson<unknown>("/api/v1/emdel/pharmacies/all", {
    query: { city: normalizedCity },
    timeoutMs: 8_000,
    maxBytes: 4 * 1024 * 1024,
  });
  return mapDaribarPharmacies(payload, daribarNetworkCode(), normalizedCity);
}
