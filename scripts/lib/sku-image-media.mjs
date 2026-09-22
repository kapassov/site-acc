const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_RETRIES = 1;
const PROBE_PREFIX_BYTES = 512;

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function safeReference(url) {
  return `${url.origin}${url.pathname}`;
}

export function resolveMediaReference(baseUrl, value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), `${baseUrl.replace(/\/$/, "")}/`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function imageKind(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (bytes.length >= 12 && bytes.subarray(4, 12).toString("ascii").startsWith("ftyp") && /avif|avis/.test(bytes.subarray(8, 24).toString("ascii"))) return "avif";
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return "icon";
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "").trimStart().toLowerCase();
  if (text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg"))) return "svg";
  return null;
}

function declaredImageKind(contentType) {
  const normalized = contentType.split(";", 1)[0].trim().toLowerCase();
  const byType = {
    "image/jpeg": "jpeg",
    "image/jpg": "jpeg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/bmp": "bmp",
    "image/x-icon": "icon",
    "image/vnd.microsoft.icon": "icon",
    "image/svg+xml": "svg",
  };
  return { normalized, kind: byType[normalized] || null };
}

async function readPrefix(body) {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  try {
    const { done, value } = await reader.read();
    if (done || !value?.byteLength) return Buffer.alloc(0);
    try {
      await reader.cancel();
    } catch {
      // The first chunk is enough; a server that already closed the stream is harmless.
    }
    return Buffer.from(value).subarray(0, PROBE_PREFIX_BYTES);
  } finally {
    reader.releaseLock();
  }
}

async function cancelBody(response) {
  try {
    await response?.body?.cancel();
  } catch {
    // Ignore cleanup failures while reporting the original HTTP result.
  }
}

async function probeResolvedMedia(url, options) {
  const {
    fetchImpl,
    timeoutMs,
    retries,
  } = options;
  let lastReason = "network_error";

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "image/avif,image/webp,image/*,*/*;q=0.1",
          Range: `bytes=0-${PROBE_PREFIX_BYTES - 1}`,
        },
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        lastReason = `http_${response.status}`;
        await cancelBody(response);
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt >= retries) {
          return { valid: false, reason: lastReason, status: response.status, reference: safeReference(url) };
        }
        await wait(Math.min(250 * (2 ** attempt), 1_000));
        continue;
      }

      const declared = declaredImageKind(response.headers.get("content-type") || "");
      const prefix = await readPrefix(response.body);
      if (prefix.length === 0) {
        return { valid: false, reason: "empty_body", status: response.status, reference: safeReference(url) };
      }

      const detectedKind = imageKind(prefix);
      if (declared.kind && detectedKind !== declared.kind) {
        return {
          valid: false,
          reason: "image_signature_mismatch",
          status: response.status,
          content_type: declared.normalized,
          reference: safeReference(url),
        };
      }
      if (!detectedKind && !declared.normalized.startsWith("image/")) {
        return {
          valid: false,
          reason: "non_image_content_type",
          status: response.status,
          content_type: declared.normalized || null,
          reference: safeReference(url),
        };
      }
      return {
        valid: true,
        reason: "ok",
        status: response.status,
        content_type: declared.normalized || null,
        detected_type: detectedKind,
        reference: safeReference(url),
      };
    } catch (error) {
      clearTimeout(timeout);
      lastReason = error?.name === "AbortError" ? "timeout" : "network_error";
      if (attempt >= retries) {
        return { valid: false, reason: lastReason, status: null, reference: safeReference(url) };
      }
      await wait(Math.min(250 * (2 ** attempt), 1_000));
    }
  }

  return { valid: false, reason: lastReason, status: null, reference: safeReference(url) };
}

/**
 * Returns a promise-cached read-only media probe. Concurrent references to the
 * same URL perform one request sequence, preserving deduplication at catalogue scale.
 */
export function createMediaProbe(baseUrl, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch is required for media validation");
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(100, options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const retries = Number.isInteger(options.retries) ? Math.max(0, options.retries) : DEFAULT_RETRIES;
  const cache = new Map();

  return (value) => {
    const resolved = resolveMediaReference(baseUrl, value);
    if (!resolved) {
      return Promise.resolve({ valid: false, reason: "invalid_url", status: null, reference: null });
    }
    const key = resolved.toString();
    if (!cache.has(key)) {
      cache.set(key, probeResolvedMedia(resolved, { fetchImpl, timeoutMs, retries }));
    }
    return cache.get(key);
  };
}
