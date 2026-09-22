import type { HTMLAttributes } from "react";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  padding?: "default" | "compact" | "none";
};

export function Card({ className = "", padding = "default", ...props }: CardProps) {
  const paddingClasses = {
    default: "p-5 sm:p-6",
    compact: "p-4",
    none: "",
  }[padding];

  return (
    <div
      className={`rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] shadow-[0_10px_30px_rgba(32,51,46,0.03)] ${paddingClasses} ${className}`}
      {...props}
    />
  );
}

export function CardHeading({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`flex items-start justify-between gap-4 ${className}`} {...props} />;
}
