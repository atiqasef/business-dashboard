"use client";

import type { ReactNode } from "react";

export function AuthShell({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  return (
    <div className="min-h-screen bg-[var(--surface)] text-[var(--ink)]">
      <div className="mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
        <div className="w-full max-w-5xl overflow-hidden rounded-[28px] border border-[var(--line)] bg-[var(--surface-raised)] shadow-[0_22px_50px_rgba(32,51,46,0.08)]">
          <div className="grid min-h-[760px] lg:grid-cols-[1.1fr_0.9fr]">
            <div className="hidden border-r border-[var(--line)] bg-[var(--surface-soft)] p-8 lg:flex lg:flex-col lg:justify-between">
              <div>
                <div className="mb-8 flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-2xl bg-[var(--ink)] text-lg font-bold text-white">L</span>
                  <div>
                    <p className="text-xs font-bold tracking-[0.2em] text-[var(--muted)] uppercase">Ledger</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">Business dashboard</p>
                  </div>
                </div>

                <div className="max-w-md space-y-6 pt-8">
                  <p className="text-xs font-bold tracking-[0.2em] text-[var(--accent)] uppercase">Welcome back</p>
                  <h1 className="text-4xl font-semibold tracking-[-0.05em] text-[var(--ink)]">Scale operations with clarity.</h1>
                  <p className="text-base leading-7 text-[var(--muted)]">
                    Monitor revenue, customers, orders, and inventory from one focused workspace built for modern teams.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] p-4">
                <div className="flex items-center justify-between text-sm text-[var(--muted)]">
                  <span>Monthly revenue</span>
                  <span className="font-semibold text-[var(--positive)]">+12.8%</span>
                </div>
                <div className="h-2 rounded-full bg-[var(--surface-soft)]">
                  <div className="h-2 w-[78%] rounded-full bg-[var(--accent)]" />
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-2xl font-semibold tracking-[-0.04em]">$84,240</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">This month</p>
                  </div>
                  <span className="rounded-full bg-[var(--positive-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--positive)]">Healthy</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-center p-6 sm:p-8 lg:p-10">
              <div className="w-full max-w-md">
                <div className="mb-8 lg:hidden">
                  <div className="mb-5 flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-xl bg-[var(--ink)] text-sm font-bold text-white">L</span>
                    <div>
                      <p className="text-[10px] font-bold tracking-[0.18em] text-[var(--muted)] uppercase">Ledger</p>
                    </div>
                  </div>
                </div>

                <div className="mb-8">
                  <p className="text-xs font-bold tracking-[0.18em] text-[var(--accent)] uppercase">Access</p>
                  <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[var(--ink)]">{title}</h2>
                  <p className="mt-2 text-sm text-[var(--muted)]">{subtitle}</p>
                </div>

                {children}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
