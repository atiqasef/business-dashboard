import { getCustomersCollection } from "@/server/db/models/customer";
import { getInvoicesCollection } from "@/server/db/models/invoice";
import { getOrdersCollection } from "@/server/db/models/order";
import { getOrganizationsCollection } from "@/server/db/models/organization";
import { getProductsCollection } from "@/server/db/models/product";
import { isSaasBillingConfigured } from "@/server/billing/prices";
import { isReadOnlyDemoUser } from "@/server/db/models/demo-account";
import { resolveOrganizationForUser } from "@/server/organizations/resolve";
import { getBusinessProfile } from "@/server/settings/business-profile";

export type OnboardingStepId =
  | "organization"
  | "businessProfile"
  | "plan"
  | "customer"
  | "product"
  | "order"
  | "invoice";

export type OnboardingStep = {
  id: OnboardingStepId;
  label: string;
  complete: boolean;
  href: string;
  cta: string;
};

export type OnboardingStatus = {
  steps: OnboardingStep[];
  completedCount: number;
  total: number;
  complete: boolean;
  completedAt: string | null;
  shouldEnterOnboarding: boolean;
  showDashboardPrompt: boolean;
  plan: { id: string; name: string };
  billingConfigured: boolean;
  readOnlyDemo: boolean;
};

async function existsForOwner(ownerUserId: string, resource: "customers" | "products" | "orders" | "invoices") {
  const filter = { ownerId: ownerUserId };
  const options = { limit: 1 } as const;
  if (resource === "customers") return (await getCustomersCollection().countDocuments(filter, options)) > 0;
  if (resource === "products") return (await getProductsCollection().countDocuments(filter, options)) > 0;
  if (resource === "orders") return (await getOrdersCollection().countDocuments(filter, options)) > 0;
  return (await getInvoicesCollection().countDocuments(filter, options)) > 0;
}

/**
 * Server-derived first-run status for the session user's workspace.
 * Completion is computed from database records, then persisted idempotently.
 */
export async function getOnboardingStatus(ownerUserId: string): Promise<OnboardingStatus> {
  if (!ownerUserId) throw new Error("ownerUserId is required");

  const readOnlyDemo = await isReadOnlyDemoUser(ownerUserId);
  const context = await resolveOrganizationForUser(ownerUserId);
  const profile = await getBusinessProfile(ownerUserId);

  const [hasCustomer, hasProduct, hasOrder, hasInvoice] = await Promise.all([
    existsForOwner(ownerUserId, "customers"),
    existsForOwner(ownerUserId, "products"),
    existsForOwner(ownerUserId, "orders"),
    existsForOwner(ownerUserId, "invoices"),
  ]);

  const profileComplete = Boolean(profile.exists && profile.businessName.trim());
  const steps: OnboardingStep[] = [
    {
      id: "organization",
      label: "Workspace created",
      complete: true,
      href: "/onboarding",
      cta: "View setup",
    },
    {
      id: "businessProfile",
      label: "Business profile",
      complete: profileComplete,
      href: "/settings",
      cta: "Add business profile",
    },
    {
      id: "plan",
      label: `Current plan: ${context.entitlements.plan.name}`,
      complete: true,
      href: "/settings",
      cta: "Review plan",
    },
    {
      id: "customer",
      label: "Add your first customer",
      complete: hasCustomer,
      href: "/customers",
      cta: "Add your first customer",
    },
    {
      id: "product",
      label: "Add your first product",
      complete: hasProduct,
      href: "/products",
      cta: "Add your first product",
    },
    {
      id: "order",
      label: "Create your first order",
      complete: hasOrder,
      href: "/orders",
      cta: "Create your first order",
    },
    {
      id: "invoice",
      label: "Create your first invoice",
      complete: hasInvoice,
      href: "/invoices",
      cta: "Create your first invoice",
    },
  ];

  const completedCount = steps.filter((step) => step.complete).length;
  const complete = completedCount === steps.length;
  const hasBusinessRecords = hasCustomer || hasProduct || hasOrder || hasInvoice;

  let completedAt = context.organization.onboarding?.completedAt ?? null;
  if (complete && !completedAt && !readOnlyDemo && context.organization._id) {
    const now = new Date();
    const updated = await getOrganizationsCollection().findOneAndUpdate(
      { _id: context.organization._id, ownerUserId, "onboarding.completedAt": { $exists: false } },
      { $set: { "onboarding.completedAt": now, updatedAt: now } },
      { returnDocument: "after" },
    );
    completedAt = updated?.onboarding?.completedAt ?? now;
  }

  const alreadyFinished = Boolean(completedAt) || complete;
  // Existing workspaces that already have records are never forced through onboarding.
  const shouldEnterOnboarding = !readOnlyDemo && !alreadyFinished && !hasBusinessRecords;

  return {
    steps,
    completedCount,
    total: steps.length,
    complete: alreadyFinished,
    completedAt: completedAt ? completedAt.toISOString() : null,
    shouldEnterOnboarding,
    showDashboardPrompt: !readOnlyDemo && !alreadyFinished,
    plan: { id: context.effectivePlanId, name: context.entitlements.plan.name },
    billingConfigured: isSaasBillingConfigured(),
    readOnlyDemo,
  };
}

/** Idempotent completion. Does nothing unless server-derived steps are all complete. Demo cannot persist. */
export async function completeOnboardingIfReady(ownerUserId: string) {
  return getOnboardingStatus(ownerUserId);
}
