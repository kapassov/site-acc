import Link from "next/link";
import { ChevronRight } from "lucide-react";

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5 text-sm text-slate-500">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-slate-300" />}
          {it.href ? (
            <Link href={it.href} className="transition hover:text-brand-700">{it.label}</Link>
          ) : (
            <span className="font-medium text-slate-700">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
