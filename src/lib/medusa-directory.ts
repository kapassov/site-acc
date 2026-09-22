import type { CatNode } from "./types.ts";

export type MedusaDirectoryGroup = {
  id: string;
  handle: string;
  name: string;
  icon: string;
  children: Array<Pick<CatNode, "id" | "handle" | "name">>;
};

const ICONS: Readonly<Record<string, string>> = {
  "lekarstva-i-bady": "HeartPulse", bady: "Pill", gigiyena: "ShowerHead",
  kosmetika: "Sparkles", linzy: "Droplets", "mama-i-malysh": "Baby",
  "med-pribory-i-izdeliya": "Stethoscope", "sport-i-fitnes": "Dumbbell", intim: "ShieldPlus",
};

function isPublicCategory(node: CatNode): boolean {
  return /^pcat_[A-Za-z0-9_-]+$/.test(node?.id || "") && /^[a-z0-9_-]{1,120}$/i.test(node?.handle || "")
    && !["site", "root", "website"].includes(node.handle.toLowerCase()) && Boolean(node.name?.trim());
}

/** Keep the existing two-level UI, but publish only IDs/handles in Medusa's tree.
 * Old Daribar directory mappings must never create imaginary native routes.
 */
export function medusaDirectory(tree: readonly CatNode[]): MedusaDirectoryGroup[] {
  return tree.filter(isPublicCategory).map((group) => ({
    id: group.id, handle: group.handle, name: group.name, icon: ICONS[group.handle] || "Package",
    children: group.children.filter(isPublicCategory).map(({ id, handle, name }) => ({ id, handle, name })),
  }));
}
