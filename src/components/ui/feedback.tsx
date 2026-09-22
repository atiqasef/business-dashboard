import { LoaderCircle, PackageOpen } from "lucide-react";

export function LoadingState({ label = "Loading workspace" }: { label?: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--line-strong)] text-sm text-[var(--muted)]">
      <LoaderCircle className="size-5 animate-spin text-[var(--accent)]" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center px-6 text-center">
      <span className="mb-3 grid size-10 place-items-center rounded-xl bg-[var(--surface-soft)] text-[var(--muted)]">
        <PackageOpen className="size-5" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-[var(--ink)]">{title}</p>
      <p className="mt-1 max-w-xs text-sm leading-6 text-[var(--muted)]">{description}</p>
    </div>
  );
}
