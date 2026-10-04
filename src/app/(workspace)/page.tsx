import { DashboardOverview } from "@/features/dashboard/components/dashboard-overview";
import { redirect } from "next/navigation";
import { isAiConfigured } from "@/server/ai/config";
import { getBusinessInsights } from "@/server/ai/insights";
import { getCurrentUserAccess } from "@/server/auth/session-access";
import { getDashboardData } from "@/server/dashboard/get-dashboard-data";
import type { DashboardData } from "@/server/dashboard/types";
import { getOnboardingStatus } from "@/server/onboarding/status";
import type { OnboardingStatus } from "@/server/onboarding/status";

export default async function Home() {
  const access = await getCurrentUserAccess();
  if (!access) redirect("/login");

  let dashboard: DashboardData | null = null;
  let insights: Awaited<ReturnType<typeof getBusinessInsights>>["insights"] = [];
  let insightsPeriodLabel = "Last 30 days";

  try {
    dashboard = await getDashboardData(access.session.user.id);
  } catch {
    dashboard = null;
  }

  try {
    const insightResult = await getBusinessInsights(access.session.user.id);
    insights = insightResult.insights;
    insightsPeriodLabel = insightResult.period.label;
  } catch {
    insights = [];
  }

  let onboarding: OnboardingStatus | null = null;
  try {
    onboarding = await getOnboardingStatus(access.session.user.id);
  } catch {
    onboarding = null;
  }

  if (!dashboard) {
    return (
      <main className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
        <div className="rounded-3xl border border-[var(--line)] bg-[var(--surface-raised)] p-6 sm:p-8">
          <p className="text-xs font-bold tracking-[0.18em] text-[var(--accent)] uppercase">Dashboard</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">Unable to load analytics</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">
            We could not load your business metrics right now. Please refresh the page or try again in a moment.
          </p>
        </div>
      </main>
    );
  }

  return (
    <DashboardOverview
      userName={access.session.user.name}
      readOnlyDemo={access.isReadOnlyDemo}
      data={dashboard}
      insights={insights}
      insightsPeriodLabel={insightsPeriodLabel}
      aiConfigured={isAiConfigured()}
      onboarding={onboarding}
    />
  );
}
