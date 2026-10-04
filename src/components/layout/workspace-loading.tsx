export function WorkspaceLoading({ label = "Loading workspace" }: { label?: string }) {
  return (
    <main className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9" aria-busy="true" aria-label={label}>
      <div className="mb-8 space-y-3">
        <div className="h-3 w-28 animate-pulse rounded-full bg-[var(--surface-soft)]" />
        <div className="h-9 w-56 animate-pulse rounded-xl bg-[var(--surface-soft)]" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded-full bg-[var(--surface-soft)]" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <div key={item} className="h-28 animate-pulse rounded-3xl border border-[var(--line)] bg-[var(--surface-raised)]" />
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="h-72 animate-pulse rounded-3xl border border-[var(--line)] bg-[var(--surface-raised)] lg:col-span-2" />
        <div className="h-72 animate-pulse rounded-3xl border border-[var(--line)] bg-[var(--surface-raised)]" />
      </div>

      <div className="mt-6 space-y-3 rounded-3xl border border-[var(--line)] bg-[var(--surface-raised)] p-5 sm:p-6">
        {[1, 2, 3, 4, 5].map((item) => (
          <div key={item} className="h-12 animate-pulse rounded-xl bg-[var(--surface-soft)]" />
        ))}
      </div>
    </main>
  );
}
