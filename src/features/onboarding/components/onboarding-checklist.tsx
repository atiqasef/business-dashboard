import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { OnboardingStatus } from "@/server/onboarding/status";

export function OnboardingChecklist({
  status,
  compact = false,
}: {
  status: OnboardingStatus;
  compact?: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--muted)]">
        {status.completedCount} of {status.total} steps completed
        {status.plan.name ? ` · ${status.plan.name} plan` : ""}
      </p>
      <ul className="space-y-2">
        {status.steps.map((step) => (
          <li
            key={step.id}
            className="flex flex-col gap-2 rounded-xl border border-[var(--line)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-center gap-2">
              <span
                className={`grid size-6 place-items-center rounded-full text-xs ${
                  step.complete
                    ? "bg-[var(--positive-soft)] text-[var(--positive)]"
                    : "bg-[var(--surface-soft)] text-[var(--muted)]"
                }`}
                aria-hidden="true"
              >
                {step.complete ? <Check className="size-3.5" /> : "○"}
              </span>
              <span className="text-sm font-medium">{step.label}</span>
            </div>
            {!step.complete && !compact ? (
              <Link href={step.href}>
                <Button type="button" variant="secondary" className="h-9">
                  {step.cta}
                </Button>
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
      {status.plan.id === "free" ? (
        <p className="text-sm leading-6 text-[var(--muted)]">
          You are on the Free plan. Paid plans are available from Settings
          {status.billingConfigured ? "." : " once subscription billing is configured."}
        </p>
      ) : (
        <p className="text-sm text-[var(--muted)]">Active plan: {status.plan.name}.</p>
      )}
    </div>
  );
}

export function OnboardingDashboardPrompt({ status }: { status: OnboardingStatus }) {
  if (!status.showDashboardPrompt) return null;

  return (
    <Card padding="compact" className="mb-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Get your business ready</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {status.completedCount} of {status.total} steps completed
          </p>
        </div>
        <Link href="/onboarding">
          <Button type="button">Complete setup</Button>
        </Link>
      </div>
    </Card>
  );
}
