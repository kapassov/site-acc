export type DeviceLocation = { lat: number; lon: number };

export type GeolocationFailureCode =
  | "unsupported"
  | "permission_denied"
  | "position_unavailable"
  | "timeout"
  | "invalid_position"
  | "aborted";

const geolocationMessages: Record<GeolocationFailureCode, string> = {
  unsupported: "В этом браузере геолокация недоступна. Выберите аптеку на карте.",
  permission_denied: "Разрешите доступ к геолокации в настройках браузера или выберите аптеку на карте.",
  position_unavailable: "Не удалось определить местоположение. Проверьте, включена ли геолокация на устройстве, и попробуйте ещё раз или выберите аптеку на карте.",
  timeout: "Определение местоположения заняло слишком много времени. Попробуйте ещё раз или выберите аптеку на карте.",
  invalid_position: "Устройство передало некорректное местоположение. Попробуйте ещё раз или выберите аптеку на карте.",
  aborted: "Определение местоположения отменено.",
};

export class GeolocationFailure extends Error {
  readonly code: GeolocationFailureCode;

  constructor(code: GeolocationFailureCode) {
    super(geolocationMessages[code]);
    this.name = "GeolocationFailure";
    this.code = code;
  }
}

function isLocation(value: unknown): value is DeviceLocation {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<DeviceLocation>;
  return typeof point.lat === "number"
    && Number.isFinite(point.lat)
    && point.lat >= -90 && point.lat <= 90
    && typeof point.lon === "number"
    && Number.isFinite(point.lon)
    && point.lon >= -180 && point.lon <= 180;
}

/** Straight-line distance only; preserve the source object and its original list index. */
export function findNearestPharmacy<T extends { lat: number; lon: number }>(
  points: readonly T[],
  location: DeviceLocation,
): { pharmacy: T; index: number; distanceKm: number } | null {
  if (!Array.isArray(points) || !isLocation(location)) return null;

  const radians = Math.PI / 180;
  const earthRadiusKm = 6371;
  let nearest: { pharmacy: T; index: number; distanceKm: number } | null = null;

  for (let index = 0; index < points.length; index += 1) {
    const pharmacy: T = points[index];
    if (!isLocation(pharmacy) || (pharmacy.lat === 0 && pharmacy.lon === 0)) continue;

    const latitudeDelta = (pharmacy.lat - location.lat) * radians;
    const longitudeDelta = (pharmacy.lon - location.lon) * radians;
    const haversine = Math.sin(latitudeDelta / 2) ** 2
      + Math.cos(location.lat * radians) * Math.cos(pharmacy.lat * radians)
      * Math.sin(longitudeDelta / 2) ** 2;
    // Rounding at coincident or antipodal points must never produce NaN.
    const clamped = Math.max(0, Math.min(1, haversine));
    const distanceKm = 2 * earthRadiusKm * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));

    if (!nearest || distanceKm < nearest.distanceKm) {
      nearest = { pharmacy, index, distanceKm };
    }
  }

  return nearest;
}

function failureCode(error: unknown): GeolocationFailureCode {
  if (error instanceof GeolocationFailure) return error.code;
  if (!error || typeof error !== "object") return "position_unavailable";

  const candidate = error as { code?: unknown; name?: unknown };
  if (candidate.name === "AbortError") return "aborted";
  if (candidate.name === "NotAllowedError" || candidate.name === "SecurityError") return "permission_denied";
  if (typeof candidate.code === "string" && Object.prototype.hasOwnProperty.call(geolocationMessages, candidate.code)) {
    return candidate.code as GeolocationFailureCode;
  }
  if (candidate.code === 1) return "permission_denied";
  if (candidate.code === 3) return "timeout";
  return "position_unavailable";
}

/** Call only from a user action. Device coordinates stay in memory, with no network requests. */
export function requestDeviceLocation(
  geolocation: Pick<Geolocation, "getCurrentPosition"> | undefined,
  signal?: AbortSignal,
): Promise<DeviceLocation> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let listening = false;

    function cleanup() {
      if (listening && signal) {
        signal.removeEventListener("abort", onAbort);
        listening = false;
      }
    }

    function fail(code: GeolocationFailureCode) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new GeolocationFailure(code));
    }

    function onAbort() {
      fail("aborted");
    }

    if (signal?.aborted) {
      fail("aborted");
      return;
    }
    if (!geolocation || typeof geolocation.getCurrentPosition !== "function") {
      fail("unsupported");
      return;
    }

    if (signal) {
      listening = true;
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        fail("aborted");
        return;
      }
    }

    try {
      geolocation.getCurrentPosition(
        (position) => {
          if (settled) return;
          const location = { lat: position?.coords?.latitude, lon: position?.coords?.longitude };
          if (!isLocation(location)) {
            fail("invalid_position");
            return;
          }
          settled = true;
          cleanup();
          resolve(location);
        },
        (error) => {
          if (!settled) fail(failureCode(error));
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
      );
    } catch (error) {
      if (!settled) fail(failureCode(error));
    }
  });
}

export function geolocationErrorMessage(error: unknown): string {
  return geolocationMessages[failureCode(error)];
}
