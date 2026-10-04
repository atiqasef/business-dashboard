import { Badge } from "@/components/ui/badge";
import { Card, CardHeading } from "@/components/ui/card";
import type { PlanFeature } from "@/server/entitlements/plans";

export type PlanStatusView = {
  name: string;
  status: "active" | "suspended";
  plan: { id: string; name: string };
  features: Record<PlanFeature, boolean>;
  billing: { subscriptionBilling: "not_implemented"; note: string };
};

const FEATURE_LABELS: Array<{ key: PlanFeature; label: string }> = [
  { key: "invoicePdf", label: "Invoice PDF" },
  { key: "invoiceEmail", label: "Invoice email" },
  { key: "reports", label: "Reports" },
  { key: "customerPortal", label: "Customer portal" },
  { key: "invoicePortal", label: "Invoice portal" },
  { key: "stripeInvoicePayments", label: "Stripe invoice payments" },
  { key: "automatedReminders", label: "Automated reminders" },
  { key: "proactiveInsights", label: "Business insights" },
  { key: "aiAssistant", label: "AI Assistant" },
  { key: "aiInsightSummary", label: "AI insight summary" },
];

export function PlanStatusCard({ planStatus }: { planStatus: PlanStatusView }) {
  return (
    <Card>
      <CardHeading>
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Current plan</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Workspace entitlements for {planStatus.name}. Subscription billing is not enabled yet.
          </p>
        </div>
        <Badge tone={planStatus.status === "active" ? "positive" : "warning"}>{planStatus.status}</Badge>
      </CardHeading>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Plan</p>
          <p className="mt-1 text-base font-semibold">{planStatus.plan.name}</p>
        </div>
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Billing</p>
          <p className="mt-1 text-sm text-[var(--muted)]">Subscription upgrades come in a later phase.</p>
        </div>
      </div>

      <ul className="mt-5 grid gap-2 sm:grid-cols-2">
        {FEATURE_LABELS.map((feature) => {
          const enabled = planStatus.features[feature.key];
          return (
            <li
              key={feature.key}
              className="flex items-center justify-between rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
            >
              <span>{feature.label}</span>
              <span className={enabled ? "font-medium text-[var(--positive)]" : "text-[var(--muted)]"}>
                {enabled ? "Available" : "Not on plan"}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-xs leading-5 text-[var(--muted)]">{planStatus.billing.note}</p>
    </Card>
  );
}
