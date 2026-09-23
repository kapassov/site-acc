import { createReadStream, promises as fs } from "fs";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const IMAGE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|gif)$/i;
const CONTENT_TYPE: Record<string, string> = {
  gif: "image/gif",
  webp: "image/webp",
};
const MAX_PUBLIC_UPLOAD_BYTES = 8 * 1024 * 1024;

type UploadMetadata = {
  filePath: string;
  contentLength: number;
  contentType: string;
};

async function uploadMetadata(
  params: Promise<{ name: string }>,
): Promise<UploadMetadata | NextResponse> {
  const { name } = await params;
  const match = name.match(IMAGE_NAME);
  if (!match) {
    return NextResponse.json({ error: "invalid_upload_name" }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), "public", "uploads", name);
  try {
    const info = await fs.stat(filePath);
    if (!info.isFile()) {
      return NextResponse.json({ error: "upload_not_found" }, { status: 404 });
    }
    if (info.size > MAX_PUBLIC_UPLOAD_BYTES) {
      return NextResponse.json({ error: "upload_too_large" }, { status: 413 });
    }
    return {
      filePath,
      contentLength: info.size,
      contentType: CONTENT_TYPE[match[1].toLowerCase()] || "application/octet-stream",
    };
  } catch {
    return NextResponse.json({ error: "upload_not_found" }, { status: 404 });
  }
}

function uploadHeaders(metadata: UploadMetadata) {
  return {
    "cache-control": "public, max-age=31536000, immutable",
    "content-length": String(metadata.contentLength),
    "content-type": metadata.contentType,
    "x-content-type-options": "nosniff",
  };
}

/** Serves newly uploaded images immediately; Next snapshots public/ at server start. */
export async function HEAD(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const metadata = await uploadMetadata(params);
  if (metadata instanceof NextResponse) {
    return new NextResponse(null, {
      status: metadata.status,
      headers: { "cache-control": "no-store" },
    });
  }
  return new NextResponse(null, { status: 200, headers: uploadHeaders(metadata) });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const metadata = await uploadMetadata(params);
  if (metadata instanceof NextResponse) return metadata;

  const nodeStream = createReadStream(/*turbopackIgnore: true*/ metadata.filePath);
  const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  return new NextResponse(body, {
    status: 200,
    headers: uploadHeaders(metadata),
  });
}
