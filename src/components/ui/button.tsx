import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "icon";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-[var(--ink)] text-white hover:bg-[var(--ink-strong)]",
  secondary: "border border-[var(--line-strong)] bg-[var(--surface-raised)] text-[var(--ink)] hover:bg-[var(--surface-soft)]",
  ghost: "text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--ink)]",
  icon: "text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--ink)]",
};

export function Button({ className = "", variant = "secondary", ...props }: ButtonProps) {
  const sizeClasses = variant === "icon" ? "size-10 justify-center p-0" : "gap-2 px-4";

  return (
    <button
      className={`inline-flex h-10 items-center rounded-xl text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:pointer-events-none disabled:opacity-50 ${sizeClasses} ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}
