import { NextResponse } from "next/server";
import { readContent, writeContent } from "@/lib/content/store";
import { isStrongRuntimeSecret } from "@/lib/serverSecrets";

// Контент меняется через админку — ответ не кэшируем.
export const dynamic = "force-dynamic";

/** Серверный токен записи. ТОЛЬКО ADMIN_TOKEN — НЕ NEXT_PUBLIC_* (инлайнится в браузер)
 *  и БЕЗ дефолта (иначе fail-open). Если не задан — запись запрещена. */
function adminToken(): string | null {
  const t = process.env.ADMIN_TOKEN;
  return isStrongRuntimeSecret(t) ? t : null;
}

const NO_STORE = { "cache-control": "no-store" };

/** Публичное чтение: и сайт, и мобильное приложение берут контент отсюда. */
export async function GET() {
  const content = await readContent();
  return NextResponse.json(content, { headers: NO_STORE });
}

/** Запись из админки. Требует заголовок x-admin-token. */
export async function POST(req: Request) {
  const expected = adminToken();
  const token = req.headers.get("x-admin-token") || "";
  if (!expected || token !== expected) {
    // fail-closed: токен не настроен ИЛИ не совпал → запись запрещена
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400, headers: NO_STORE });
  }
  try {
    const saved = await writeContent(body);
    return NextResponse.json(saved, { headers: NO_STORE });
  } catch (error) {
    console.error("[api/content] content persistence failed:", error);
    return NextResponse.json({ error: "content_persist_failed" }, { status: 503, headers: NO_STORE });
  }
}
