import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { isStrongRuntimeSecret } from "@/lib/serverSecrets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" };
const MAX_IMAGE = 8 * 1024 * 1024; // 8 МБ
const MAX_VIDEO = 60 * 1024 * 1024; // 60 МБ
const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
};

/** ТОЛЬКО ADMIN_TOKEN (не NEXT_PUBLIC_*, без дефолта). Не задан → загрузка запрещена. */
function adminToken(): string | null {
  const t = process.env.ADMIN_TOKEN;
  return isStrongRuntimeSecret(t) ? t : null;
}

/** Загрузка фото/видео для баннеров и сторис. Сохраняет в public/uploads, отдаёт { url, type }. */
export async function POST(req: Request) {
  const expected = adminToken();
  const token = req.headers.get("x-admin-token") || "";
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  // Лимит залива: даже валидный админ не может забить диск (30 файлов/мин на IP).
  if (!rateLimit(`upload:${clientIp(req)}`, 30, 60_000, Date.now())) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: NO_STORE });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad form" }, { status: 400, headers: NO_STORE });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file" }, { status: 400, headers: NO_STORE });
  }

  const mime = file.type;
  const ext = EXT[mime];
  if (!ext) {
    return NextResponse.json({ error: `unsupported type: ${mime}` }, { status: 415, headers: NO_STORE });
  }
  const isVideo = mime.startsWith("video/");
  const limit = isVideo ? MAX_VIDEO : MAX_IMAGE;
  if (file.size > limit) {
    return NextResponse.json({ error: `too large (>${Math.round(limit / 1024 / 1024)}MB)` }, { status: 413, headers: NO_STORE });
  }

  const dir = path.join(process.cwd(), "public", "uploads");
  await fs.mkdir(dir, { recursive: true });
  const source = Buffer.from(await file.arrayBuffer());
  const convertToWebp = mime === "image/jpeg" || mime === "image/png";
  let output = source;
  let outputExt = ext;
  if (convertToWebp) {
    try {
      output = Buffer.from(
        await sharp(source, { limitInputPixels: 40_000_000 })
          .rotate()
          .webp({ quality: 85, alphaQuality: 100, effort: 5, smartSubsample: true })
          .toBuffer(),
      );
      outputExt = "webp";
    } catch {
      return NextResponse.json({ error: "invalid image" }, { status: 400, headers: NO_STORE });
    }
  }
  const name = `${randomUUID()}.${outputExt}`;
  await fs.writeFile(path.join(dir, name), output);

  // Относительный URL — портативен между доменами; мобилка дорисует CONTENT_BASE.
  const url = isVideo ? `/uploads/${name}` : `/api/uploads/${name}`;
  return NextResponse.json({ url, type: isVideo ? "video" : "image" }, { headers: NO_STORE });
}
