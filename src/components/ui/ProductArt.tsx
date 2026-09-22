import type { ProductArt as ProductArtType, ProductArtKind } from "@/lib/types";

/**
 * Самодостаточная иллюстрация-плейсхолдер вместо фото товара.
 * Когда подключим DAM/реальные фото из PIM — этот компонент заменится на <Image/>.
 */
export function ProductArt({ art, className }: { art: ProductArtType; className?: string }) {
  const { hue, kind } = art;
  const base = `hsl(${hue} 42% 64%)`;
  const dark = `hsl(${hue} 44% 52%)`;
  const light = `hsl(${hue} 70% 92%)`;
  const cap = `hsl(${hue} 28% 42%)`;
  const bg1 = `hsl(${hue} 58% 97%)`;
  const bg2 = `hsl(${hue} 62% 90%)`;

  return (
    <div
      className={className}
      style={{ background: `radial-gradient(120% 100% at 50% 0%, ${bg1} 0%, ${bg2} 100%)` }}
    >
      <svg viewBox="0 0 200 200" className="h-full w-full" role="img" aria-hidden>
        {/* floor shadow */}
        <ellipse cx="100" cy="178" rx="46" ry="9" fill={dark} opacity="0.14" />
        <Shape kind={kind} base={base} dark={dark} light={light} cap={cap} />
      </svg>
    </div>
  );
}

function Shape({
  kind,
  base,
  dark,
  light,
  cap,
}: {
  kind: ProductArtKind;
  base: string;
  dark: string;
  light: string;
  cap: string;
}) {
  const highlight = (x: number, y: number, h: number) => (
    <rect x={x} y={y} width="7" height={h} rx="3.5" fill="#fff" opacity="0.3" />
  );

  switch (kind) {
    case "bottle":
      return (
        <g>
          <rect x="84" y="24" width="32" height="18" rx="4" fill={cap} />
          <rect x="90" y="40" width="20" height="12" fill={dark} />
          <rect x="70" y="50" width="60" height="120" rx="20" fill={base} />
          <rect x="70" y="96" width="60" height="44" fill={light} opacity="0.85" />
          {highlight(80, 60, 100)}
        </g>
      );
    case "tube":
      return (
        <g>
          <rect x="86" y="26" width="28" height="20" rx="4" fill={cap} />
          <path d="M74 64 C74 50 126 50 126 64 V160 H74 Z" fill={base} />
          <rect x="74" y="160" width="52" height="9" rx="2" fill={dark} />
          <rect x="74" y="100" width="52" height="40" fill={light} opacity="0.85" />
          {highlight(83, 66, 92)}
        </g>
      );
    case "jar":
      return (
        <g>
          <rect x="68" y="40" width="64" height="26" rx="10" fill={cap} />
          <rect x="64" y="64" width="72" height="90" rx="18" fill={base} />
          <rect x="64" y="96" width="72" height="34" fill={light} opacity="0.85" />
          {highlight(74, 74, 70)}
        </g>
      );
    case "box":
      return (
        <g>
          <rect x="64" y="40" width="72" height="130" rx="8" fill={base} />
          <rect x="64" y="40" width="72" height="22" rx="8" fill={dark} />
          <rect x="64" y="56" width="72" height="6" fill={dark} opacity="0.5" />
          {/* аптечный крест */}
          <rect x="94" y="92" width="12" height="36" rx="2" fill="#fff" opacity="0.9" />
          <rect x="82" y="104" width="36" height="12" rx="2" fill="#fff" opacity="0.9" />
          {highlight(72, 66, 96)}
        </g>
      );
    case "dropper":
      return (
        <g>
          <circle cx="100" cy="16" r="9" fill={cap} />
          <rect x="96" y="22" width="8" height="34" fill={dark} />
          <rect x="82" y="54" width="36" height="18" rx="4" fill={cap} />
          <rect x="78" y="70" width="44" height="98" rx="16" fill={base} />
          <rect x="78" y="104" width="44" height="36" fill={light} opacity="0.85" />
          {highlight(87, 80, 78)}
        </g>
      );
    case "spray":
      return (
        <g>
          <rect x="62" y="48" width="14" height="7" rx="2" fill={dark} />
          <rect x="74" y="40" width="30" height="22" rx="5" fill={cap} />
          <rect x="76" y="60" width="48" height="108" rx="16" fill={base} />
          <rect x="76" y="98" width="48" height="40" fill={light} opacity="0.85" />
          {highlight(85, 70, 90)}
        </g>
      );
  }
}
