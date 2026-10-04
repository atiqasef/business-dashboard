import { DashboardShell } from "@/components/layout/dashboard-shell";
import { DashboardOverview } from "@/features/dashboard/components/dashboard-overview";
import { redirect } from "next/navigation";
import { getCurrentUserAccess } from "@/server/auth/session-access";
import { getDashboardData } from "@/server/dashboard/get-dashboard-data";
import type { DashboardData } from "@/server/dashboard/types";

export default async function Home() {
  const access = await getCurrentUserAccess();
  if (!access) redirect("/login");

  let dashboard: DashboardData | null = null;
  try {
    dashboard = await getDashboardData(access.session.user.id);
  } catch {
    dashboard = null;
  }

  if (!dashboard) {
    return (
      <DashboardShell userName={access.session.user.name} readOnlyDemo={access.isReadOnlyDemo}>
        <main className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
          <div className="rounded-3xl border border-[var(--line)] bg-[var(--surface-raised)] p-6 sm:p-8">
            <p className="text-xs font-bold tracking-[0.18em] text-[var(--accent)] uppercase">Dashboard</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">Unable to load analytics</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">
              We could not load your business metrics right now. Please refresh the page or try again in a moment.
            </p>
          </div>
        </main>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      userName={access.session.user.name}
      readOnlyDemo={access.isReadOnlyDemo}
      pendingOrdersCount={dashboard.summary.pendingOrders}
    >
      <DashboardOverview
        userName={access.session.user.name}
        readOnlyDemo={access.isReadOnlyDemo}
        data={dashboard}
      />
    </DashboardShell>
  );
}
