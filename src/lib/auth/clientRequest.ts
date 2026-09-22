/** OTP requests must settle even on a stalled mobile connection. Never retry a
 * mutation automatically: the provider may already have sent/consumed the SMS. */
export async function requestAuthJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = 45_000,
): Promise<{ response: Response; payload: Record<string, unknown> }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    const raw: unknown = await response.json().catch((error: unknown) => {
      if (controller.signal.aborted) throw error;
      return {};
    });
    if (controller.signal.aborted) throw new Error("auth_request_aborted");
    const payload = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    return { response, payload };
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}
