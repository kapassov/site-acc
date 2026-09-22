import { NextResponse } from "next/server";
import { getProductBySlug } from "@/lib/api";

export const dynamic = "force-dynamic";

const HANDLE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/;

/** Rich PDP fields are streamed after the fast catalogue summary is visible. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!HANDLE.test(slug)) return NextResponse.json({ product: null }, { status: 400 });
  if (slug.startsWith("daribar-")) {
    return NextResponse.json(
      { product: null },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const product = await getProductBySlug(slug);
    if (!product) {
      return NextResponse.json(
        { product: null },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    }
    return NextResponse.json(
      { product },
      { status: 200, headers: { "cache-control": "public, max-age=30, s-maxage=120, stale-while-revalidate=1800" } },
    );
  } catch {
    return NextResponse.json(
      { product: null, degraded: true },
      { status: 503, headers: { "cache-control": "no-store", "retry-after": "5" } },
    );
  }
}
