import type { HTMLAttributes } from "react";

type BadgeTone = "positive" | "warning" | "neutral" | "accent";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

const toneClasses: Record<BadgeTone, string> = {
  positive: "bg-[var(--positive-soft)] text-[var(--positive)]",
  warning: "bg-[var(--warning-soft)] text-[var(--warning)]",
  neutral: "bg-[var(--surface-soft)] text-[var(--muted)]",
  accent: "bg-[var(--accent-soft)] text-[var(--accent-strong)]",
};

export function Badge({ className = "", tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${toneClasses[tone]} ${className}`}
      {...props}
    />
  );
}
