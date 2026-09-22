// The Yandex Maps JavaScript API is loaded only in the browser. Keeping the
// loader in one module prevents the pharmacies page and checkout modal from
// adding competing script tags when they are mounted at the same time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type YandexMapsApi = any;

declare global {
  interface Window {
    ymaps?: YandexMapsApi;
  }
}

const SCRIPT_ID = "yandex-maps-js-api";
const LOAD_TIMEOUT_MS = 15_000;

let loaderPromise: Promise<YandexMapsApi> | null = null;

function waitUntilReady(ymaps: YandexMapsApi): Promise<YandexMapsApi> {
  return new Promise((resolve) => ymaps.ready(() => resolve(ymaps)));
}

/** Load Yandex Maps JS API 2.1 once and resolve only after `ymaps.ready`. */
export function loadYandexMaps(apiKey: string): Promise<YandexMapsApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Yandex Maps can only be loaded in a browser"));
  }
  if (!apiKey) {
    return Promise.reject(new Error("NEXT_PUBLIC_YANDEX_MAPS_KEY is not configured"));
  }
  if (window.ymaps) return waitUntilReady(window.ymaps);
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<YandexMapsApi>((resolve, reject) => {
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    let settled = false;

    const cleanupListeners = () => {
      script?.removeEventListener("load", handleLoad);
      script?.removeEventListener("error", handleError);
      window.clearTimeout(timeoutId);
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      script?.remove();
      loaderPromise = null;
      reject(new Error(message));
    };

    const handleLoad = () => {
      if (!window.ymaps) {
        fail("Yandex Maps API loaded without the ymaps object");
        return;
      }
      waitUntilReady(window.ymaps)
        .then((ymaps) => {
          if (settled) return;
          settled = true;
          cleanupListeners();
          resolve(ymaps);
        })
        .catch(() => fail("Yandex Maps API failed to initialize"));
    };

    const handleError = () => fail("Yandex Maps API script failed to load");
    const timeoutId = window.setTimeout(
      () => fail("Yandex Maps API loading timed out"),
      LOAD_TIMEOUT_MS,
    );

    if (!script) {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.async = true;
      script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`;
      document.head.appendChild(script);
    }

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });

    // The script may have completed between the initial global check and
    // listener registration (for example, from the browser HTTP cache).
    if (window.ymaps) handleLoad();
  });

  return loaderPromise;
}
