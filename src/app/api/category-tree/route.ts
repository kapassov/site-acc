import { NextResponse } from "next/server";
import { getCatTree } from "@/lib/api";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function GET() {
  try {
    const tree = await getCatTree();
    if (!tree.length) throw new Error("category_tree_unavailable");
    return NextResponse.json(tree, { headers: { "cache-control": "public, max-age=60, s-maxage=600", "x-catalog-source": "medusa" } });
  } catch {
    return NextResponse.json({ error: "category_tree_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
