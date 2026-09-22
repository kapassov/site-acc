import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createDemoSessionForInstallId,
  demoIdentity,
  isValidDemoInstallId,
  readDemoSession,
} from "@/lib/customerAuthMode";
import { readBoundedJson, RequestBodyError } from "@/lib/httpBody";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" };
const COOKIE = "inkar_demo_session";
const SECRET = process.env.CUSTOMER_AUTH_SECRET || "";
const MAX_BODY_BYTES = 4 * 1024;

function cleanName(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .slice(0, 2)
    .join(" ")
    .slice(0, 100);
}

function user(sessionId: string, requestedName: unknown = "") {
  const identity = demoIdentity(sessionId, SECRET);
  return {
    name: cleanName(requestedName) || "Демо-покупатель",
    phone: identity.phone,
    email: null,
    birthDate: null,
    gender: null,
    addresses: [],
    defaultAddress: null,
    bonus: 1500,
    level: "Silver",
    demo: true,
  };
}

async function session(req: Request): Promise<{ signed: string; id: string } | null> {
  const cookieStore = await cookies();
  const signed = req.headers.get("x-demo-session")
    || cookieStore.get(COOKIE)?.value
    || null;
  const id = readDemoSession(signed, SECRET);
  return signed && id ? { signed, id } : null;
}

function setSessionCookie(response: NextResponse, value: string, maxAge: number): void {
  response.cookies.set(COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge,
  });
}

export async function GET(req: Request) {
  const current = await session(req);
  return NextResponse.json({
    user: current ? user(current.id) : null,
    authMode: "demo",
    profileComplete: Boolean(current),
  }, { status: current ? 200 : 401, headers: NO_STORE });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await readBoundedJson<Record<string, unknown>>(req, MAX_BODY_BYTES);
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    const code = error instanceof RequestBodyError ? error.code : "invalid_json";
    return NextResponse.json({ error: code }, { status, headers: NO_STORE });
  }

  const action = String(body.action || "demo");
  if (action === "demo") {
    if (!SECRET) {
      return NextResponse.json({ error: "auth_unavailable" }, { status: 503, headers: NO_STORE });
    }
    if (!rateLimit(`app-review-session:${clientIp(req)}`, 12, 60 * 60_000, Date.now())) {
      return NextResponse.json({ error: "too_many_requests" }, { status: 429, headers: NO_STORE });
    }
    const installId = String(body.installId || "").trim();
    if (!isValidDemoInstallId(installId)) {
      return NextResponse.json({ error: "bad_install_id" }, { status: 400, headers: NO_STORE });
    }
    const signed = createDemoSessionForInstallId(installId, SECRET);
    const id = readDemoSession(signed, SECRET);
    if (!id) {
      return NextResponse.json({ error: "auth_unavailable" }, { status: 503, headers: NO_STORE });
    }
    const response = NextResponse.json({
      user: user(id, body.name),
      authMode: "demo",
      token: signed,
      demoSession: signed,
      profileComplete: true,
    }, { headers: NO_STORE });
    setSessionCookie(response, signed, 90 * 24 * 60 * 60);
    return response;
  }

  const current = await session(req);
  if (!current) {
    return NextResponse.json({ error: "no_session" }, { status: 401, headers: NO_STORE });
  }
  if (action === "update") {
    return NextResponse.json({
      user: user(current.id, body.name),
      profileComplete: true,
    }, { headers: NO_STORE });
  }
  if (action === "delete") {
    const response = NextResponse.json({ ok: true, status: "deleted" }, {
      status: 202,
      headers: NO_STORE,
    });
    setSessionCookie(response, "", 0);
    return response;
  }
  return NextResponse.json({ error: "bad_action" }, { status: 400, headers: NO_STORE });
}
