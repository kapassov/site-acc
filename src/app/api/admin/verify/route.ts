import { NextResponse } from "next/server";
import { isStrongRuntimeSecret } from "@/lib/serverSecrets";

// Проверка токена входа в админку НА СЕРВЕРЕ (а не сравнением с NEXT_PUBLIC_* в браузере).
// Клиент шлёт введённый код в заголовке x-admin-token; сверяем с серверным ADMIN_TOKEN.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const expected = process.env.ADMIN_TOKEN;
  const token = req.headers.get("x-admin-token") || "";
  if (!isStrongRuntimeSecret(expected) || token !== expected) {
    return NextResponse.json({ ok: false }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
