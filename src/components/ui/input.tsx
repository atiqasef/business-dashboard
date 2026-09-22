import type { InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
};

export function Input({ className = "", label, id, ...props }: InputProps) {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-2">
      {label ? <span className="sr-only">{label}</span> : null}
      <input
        id={id}
        className={`h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] ${className}`}
        {...props}
      />
    </label>
  );
}
