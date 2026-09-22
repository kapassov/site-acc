export class RequestBodyError extends Error {
  status: 400 | 413;
  code: "invalid_json" | "payload_too_large";

  constructor(status: 400 | 413, code: "invalid_json" | "payload_too_large") {
    super(code);
    this.name = "RequestBodyError";
    this.status = status;
    this.code = code;
  }
}

function payloadTooLarge(): never {
  throw new RequestBodyError(413, "payload_too_large");
}

export async function readBoundedJson<T = unknown>(
  request: Request,
  maximumBytes: number,
): Promise<T> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new TypeError("maximumBytes must be a positive safe integer");
  }

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) payloadTooLarge();
  if (!request.body) throw new RequestBodyError(400, "invalid_json");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("payload_too_large").catch(() => undefined);
        payloadTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new RequestBodyError(400, "invalid_json");
  }
}
