import {
  Sparkles, Droplets, Baby, Pill, HeartPulse, ShowerHead, Sun, Brush, Stethoscope,
  Activity, Dumbbell, Leaf, Package, ShieldPlus,
  type LucideIcon,
} from "lucide-react";

const registry: Record<string, LucideIcon> = {
  Sparkles, Droplets, Baby, Pill, HeartPulse, ShowerHead, Sun, Brush, Stethoscope,
  Activity, Dumbbell, Leaf, Package, ShieldPlus,
};

export function CategoryIcon({ name, className }: { name: string; className?: string }) {
  const Icon = registry[name] ?? Sparkles;
  return <Icon className={className} />;
}
