import type { ReactNode } from "react";

export function TablePlaceholder({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-xl border border-[var(--line)]">{children}</div>;
}

export function DialogPlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--surface-soft)] p-5 text-sm text-[var(--muted)]">
      {children}
    </div>
  );
}
