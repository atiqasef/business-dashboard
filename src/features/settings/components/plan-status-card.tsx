"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import type { PlanFeature } from "@/server/entitlements/plans";

export type PlanStatusView = {
  name: string;
  status: "active" | "suspended";
  plan: { id: string; name: string };
  features: Record<PlanFeature, boolean>;
  subscription: {
    status: string;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
    currentPeriodStart: string | null;
  };
  billing: {
    subscriptionBilling: "configured" | "not_configured";
    note: string;
    availablePlans: Array<{ id: string; checkoutAvailable: boolean }>;
  };
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

function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(value),
  );
}

export function PlanStatusCard({
  planStatus,
  readOnlyDemo,
}: {
  planStatus: PlanStatusView;
  readOnlyDemo: boolean;
}) {
  const [loading, setLoading] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const billingConfigured = planStatus.billing.subscriptionBilling === "configured";
  const hasPaidSubscription =
    planStatus.subscription.status !== "none" &&
    !["canceled", "incomplete_expired", "unpaid"].includes(planStatus.subscription.status);

  async function startCheckout(planId: string) {
    if (readOnlyDemo || loading || !billingConfigured) return;
    setLoading("checkout");
    setError(null);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        data?: { url?: string };
        error?: string;
      };
      if (!response.ok || !payload.data?.url) {
        setError(payload.error || "Unable to start checkout.");
        return;
      }
      window.location.assign(payload.data.url);
    } catch {
      setError("Unable to start checkout.");
    } finally {
      setLoading(null);
    }
  }

  async function openPortal() {
    if (readOnlyDemo || loading || !billingConfigured) return;
    setLoading("portal");
    setError(null);
    try {
      const response = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        data?: { url?: string };
        error?: string;
      };
      if (!response.ok || !payload.data?.url) {
        setError(payload.error || "Unable to open billing portal.");
        return;
      }
      window.location.assign(payload.data.url);
    } catch {
      setError("Unable to open billing portal.");
    } finally {
      setLoading(null);
    }
  }

  const periodEnd = formatDate(planStatus.subscription.currentPeriodEnd);

  return (
    <Card>
      <CardHeading>
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Billing & plan</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            SaaS subscription for {planStatus.name}. Customer invoice payments are separate.
          </p>
        </div>
        <Badge tone={planStatus.status === "active" ? "positive" : "warning"}>{planStatus.status}</Badge>
      </CardHeading>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Current plan</p>
          <p className="mt-1 text-base font-semibold">{planStatus.plan.name}</p>
        </div>
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Subscription</p>
          <p className="mt-1 text-sm font-medium capitalize">{planStatus.subscription.status.replaceAll("_", " ")}</p>
          {periodEnd ? (
            <p className="mt-1 text-xs text-[var(--muted)]">
              {planStatus.subscription.cancelAtPeriodEnd ? "Ends" : "Renews"} {periodEnd}
            </p>
          ) : null}
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
                {enabled ? "Available" : "Upgrade required"}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 flex flex-wrap gap-2">
        {billingConfigured && !readOnlyDemo ? (
          <>
            {hasPaidSubscription ? (
              <Button type="button" variant="secondary" disabled={loading !== null} onClick={() => void openPortal()}>
                {loading === "portal" ? "Opening…" : "Manage billing"}
              </Button>
            ) : null}
            {planStatus.billing.availablePlans
              .filter((plan) => plan.checkoutAvailable && plan.id !== planStatus.plan.id)
              .map((plan) => (
                <Button
                  key={plan.id}
                  type="button"
                  disabled={loading !== null}
                  onClick={() => void startCheckout(plan.id)}
                >
                  {loading === "checkout" ? "Starting…" : `Upgrade to ${plan.id}`}
                </Button>
              ))}
          </>
        ) : null}
      </div>

      {!billingConfigured ? (
        <p className="mt-4 text-sm text-[var(--muted)]">
          Billing is not configured. The Free plan remains available. Configure Stripe price IDs to enable upgrades.
        </p>
      ) : null}
      {readOnlyDemo ? (
        <p className="mt-4 text-sm text-[var(--muted)]">Demo accounts can view billing status but cannot subscribe.</p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-[var(--warning)]">{error}</p> : null}
      <p className="mt-4 text-xs leading-5 text-[var(--muted)]">{planStatus.billing.note}</p>
    </Card>
  );
}
