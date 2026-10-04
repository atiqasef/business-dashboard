import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { OnboardingChecklist } from "@/features/onboarding/components/onboarding-checklist";
import { getCurrentUserAccess } from "@/server/auth/session-access";
import { getOnboardingStatus } from "@/server/onboarding/status";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const access = await getCurrentUserAccess();
  if (!access) redirect("/login");

  const status = await getOnboardingStatus(access.session.user.id);

  return (
    <main className="mx-auto max-w-3xl px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
      <p className="mb-2 text-xs font-bold tracking-[0.18em] text-[var(--accent)] uppercase">Setup</p>
      <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Welcome to your Business Dashboard</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
        This short setup uses your real workspace data so you can add a customer, a product, an order, and an invoice.
      </p>

      <Card className="mt-6">
        {status.complete ? (
          <div>
            <h2 className="text-lg font-semibold">Your workspace is ready.</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Every first-run step is already satisfied from your account data.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/"><Button type="button">Go to Dashboard</Button></Link>
              <Link href="/reports"><Button type="button" variant="secondary">View Reports</Button></Link>
              <Link href="/customers"><Button type="button" variant="secondary">Manage Customers</Button></Link>
              <Link href="/invoices"><Button type="button" variant="secondary">Manage Invoices</Button></Link>
            </div>
          </div>
        ) : (
          <OnboardingChecklist status={status} />
        )}
        {status.readOnlyDemo ? (
          <p className="mt-4 text-sm text-[var(--muted)]">Demo accounts can review setup status but cannot change workspace data.</p>
        ) : null}
      </Card>
    </main>
  );
}
