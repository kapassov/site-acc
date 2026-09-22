import type { ReactNode } from "react";

const ICONS: Record<string, ReactNode> = {
  shield: (<><path d="M12 3l7 3v5c0 4.2-3 7.4-7 9-4-1.6-7-4.8-7-9V6l7-3Z" /><path d="M12 8.5v5M9.5 11h5" /></>),
  moon: (<path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z" />),
  sparkle: (<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Z" />),
  drop: (<path d="M12 3.5s6 6.3 6 10.5a6 6 0 0 1-12 0c0-4.2 6-10.5 6-10.5Z" />),
  sun: (<><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" /></>),
  flower: (<><circle cx="12" cy="12" r="2.3" /><circle cx="12" cy="6.6" r="2.3" /><circle cx="12" cy="17.4" r="2.3" /><circle cx="6.6" cy="12" r="2.3" /><circle cx="17.4" cy="12" r="2.3" /></>),
  baby: (<><circle cx="12" cy="8" r="3.4" /><path d="M5 20c1-3.4 4-5 7-5s6 1.6 7 5" /><path d="M10.6 7.6h.01M13.4 7.6h.01" /></>),
  pill: (<><path d="M5 13 13 5a4 4 0 0 1 6 6l-8 8a4 4 0 0 1-6-6Z" /><path d="m9 9 6 6" /></>),
  heart: (<path d="M12 20.5 4.2 12.7a4.8 4.8 0 0 1 6.8-6.8l1 1 1-1a4.8 4.8 0 0 1 6.8 6.8L12 20.5Z" />),
  gift: (<><rect x="4" y="9" width="16" height="11" rx="1.5" /><path d="M4 13h16M12 9v11M12 9c-2 0-4-1-4-3s2-2 4 3c2-5 4-4 4-3s-2 3-4 3" /></>),
  leaf: (<><path d="M5 19c0-8 6-13 14-13 0 8-5 14-13 14-1 0-1-1-1-1Z" /><path d="M5 19c3-4 6-6 9-7" /></>),
  eye: (<><path d="M2 12s4-6.5 10-6.5S22 12 22 12s-4 6.5-10 6.5S2 12 2 12Z" /><circle cx="12" cy="12" r="2.6" /></>),
  wind: (<><path d="M3 8h10a2.5 2.5 0 1 0-2.5-2.5" /><path d="M3 12h15a2.5 2.5 0 1 1-2.5 2.5" /><path d="M3 16h8" /></>),
  stethoscope: (<><path d="M5 3v5a4 4 0 0 0 8 0V3" /><path d="M9 16a5 5 0 0 0 10 0v-3" /><circle cx="19" cy="11" r="2" /></>),
  truck: (<><rect x="2" y="6" width="12" height="10" rx="1.5" /><path d="M14 9h4l3 3v4h-7" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></>),
};

export const ICON_NAMES = Object.keys(ICONS);

export function CollectionIcon({ name, className }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {ICONS[name] ?? ICONS.sparkle}
    </svg>
  );
}
