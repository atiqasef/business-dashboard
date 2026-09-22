export default function Home() {
  return (
    <div className="min-h-screen overflow-hidden bg-[var(--surface)] text-[var(--ink)]">
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6 lg:px-10">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-[var(--ink)] text-sm font-bold text-white">
            L
          </span>
          <span className="text-sm font-semibold tracking-[0.18em] text-[var(--ink)] uppercase">
            Ledger
          </span>
        </div>
        <span className="hidden text-xs font-medium tracking-[0.16em] text-[var(--muted)] uppercase sm:block">
          Business operations, clearly arranged
        </span>
      </header>

      <main className="mx-auto grid w-full max-w-7xl gap-16 px-6 pb-16 pt-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:px-10 lg:pb-24 lg:pt-20">
        <section className="max-w-2xl">
          <p className="mb-6 text-xs font-bold tracking-[0.22em] text-[var(--accent)] uppercase">
            Business management workspace
          </p>
          <h1 className="max-w-xl text-5xl leading-[0.98] font-semibold tracking-[-0.04em] text-[var(--ink)] sm:text-7xl">
            See the whole business at a glance.
          </h1>
          <p className="mt-8 max-w-lg text-lg leading-8 text-[var(--muted)]">
            Ledger is being built as a calm, practical command center for customers, products, orders, payments, and the decisions between them.
          </p>
          <div className="mt-10 flex items-center gap-4">
            <span className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-white">
              Foundation in progress
              <span aria-hidden="true">&rarr;</span>
            </span>
            <span className="text-sm font-medium text-[var(--muted)]">Phase 1 of 12</span>
          </div>
        </section>

        <section aria-label="Product areas" className="relative">
          <div className="absolute -right-16 -top-16 size-56 rounded-full bg-[var(--accent-soft)] blur-3xl" />
          <div className="relative border border-[var(--line)] bg-white/80 p-5 shadow-[0_24px_80px_rgba(34,49,43,0.08)] backdrop-blur-sm sm:p-7">
            <div className="flex items-center justify-between border-b border-[var(--line)] pb-5">
              <div>
                <p className="text-xs font-semibold tracking-[0.16em] text-[var(--muted)] uppercase">Workspace map</p>
                <p className="mt-2 text-xl font-semibold tracking-[-0.02em]">The operating picture</p>
              </div>
              <span className="size-3 rounded-full bg-[var(--accent)]" aria-label="In development" />
            </div>
            <div className="grid grid-cols-2 gap-3 pt-5 sm:grid-cols-3">
              {[
                ["01", "Dashboard"],
                ["02", "Customers"],
                ["03", "Products"],
                ["04", "Orders"],
                ["05", "Payments"],
                ["06", "Reports"],
              ].map(([number, label]) => (
                <div key={number} className="min-h-28 border border-[var(--line)] bg-[var(--surface)] p-4">
                  <p className="text-xs font-bold text-[var(--accent)]">{number}</p>
                  <p className="mt-7 text-sm font-semibold">{label}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between bg-[var(--ink)] px-4 py-3 text-xs text-white/70">
              <span>Data layer</span>
              <span className="font-semibold text-white">Coming next</span>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-7xl flex-col gap-3 border-t border-[var(--line)] px-6 py-6 text-xs text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between lg:px-10">
        <span>Built for better business decisions.</span>
        <span className="font-medium">Next.js &middot; TypeScript &middot; Tailwind CSS</span>
      </footer>
    </div>
  );
}
