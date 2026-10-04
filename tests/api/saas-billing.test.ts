import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type Stripe from "stripe";
import { POST as createCheckout } from "@/server/api/billing-checkout";
import { POST as createPortal } from "@/server/api/billing-portal";
import { GET as getOrganization } from "@/server/api/organization";
import { handleStripeWebhookEvent } from "@/server/payments/stripe-webhook";
import { resolveEffectivePlanId } from "@/server/billing/effective-plan";
import {
  isSaasBillingConfigured,
  mapPlanToStripePriceId,
  mapStripePriceIdToPlan,
} from "@/server/billing/prices";
import { ensureStripeCustomerForOrganization } from "@/server/billing/customer";
import { syncStripeSubscription } from "@/server/billing/sync";
import { SAAS_BILLING_CONTEXT } from "@/server/billing/checkout";
import { getOrganizationsCollection } from "@/server/db/models/organization";
import { getSubscriptionsCollection } from "@/server/db/models/subscription";
import { ensureOrganizationForUser } from "@/server/organizations/provision";
import { resolveOrganizationForUser } from "@/server/organizations/resolve";
import { STRIPE_PAYMENT_CONTEXT } from "@/server/payments/providers/stripe-provider";
import { resetStripeClientForTests } from "@/server/payments/providers/stripe-client";
import { demoUser, mockSession, userA, userB } from "../helpers/auth";
import { markDemoUser } from "../helpers/fixtures";
import { jsonRequest, readJson } from "../helpers/http";

const PRICE_STARTER = "price_test_starter";
const PRICE_PRO = "price_test_pro";
const PRICE_BUSINESS = "price_test_business";

const stripeMocks = {
  customersCreate: vi.fn(),
  customersDel: vi.fn(),
  checkoutCreate: vi.fn(),
  portalCreate: vi.fn(),
  subscriptionsRetrieve: vi.fn(),
};

vi.mock("@/server/payments/providers/stripe-client", async () => {
  const actual = await vi.importActual<typeof import("@/server/payments/providers/stripe-client")>(
    "@/server/payments/providers/stripe-client",
  );
  return {
    ...actual,
    getStripeClient: () => ({
      customers: {
        create: stripeMocks.customersCreate,
        del: stripeMocks.customersDel,
      },
      checkout: {
        sessions: {
          create: stripeMocks.checkoutCreate,
          expire: vi.fn(),
        },
      },
      billingPortal: {
        sessions: {
          create: stripeMocks.portalCreate,
        },
      },
      subscriptions: {
        retrieve: stripeMocks.subscriptionsRetrieve,
      },
      webhooks: { constructEvent: () => ({}) },
    }),
  };
});

function setBillingEnv() {
  process.env.STRIPE_SECRET_KEY = "sk_test_saas";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_saas";
  process.env.STRIPE_PRICE_STARTER = PRICE_STARTER;
  process.env.STRIPE_PRICE_PRO = PRICE_PRO;
  process.env.STRIPE_PRICE_BUSINESS = PRICE_BUSINESS;
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
}

function clearBillingEnv() {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_PRICE_STARTER;
  delete process.env.STRIPE_PRICE_PRO;
  delete process.env.STRIPE_PRICE_BUSINESS;
}

function stripeSubscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: "sub_test_1",
    object: "subscription",
    status: "active",
    customer: "cus_test_1",
    cancel_at_period_end: false,
    current_period_start: Math.floor(Date.now() / 1000) - 1000,
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    canceled_at: null,
    trial_start: null,
    trial_end: null,
    metadata: {},
    items: {
      object: "list",
      data: [
        {
          id: "si_1",
          object: "subscription_item",
          price: { id: PRICE_PRO, object: "price" },
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

describe("SaaS billing foundations", () => {
  beforeEach(() => {
    clearBillingEnv();
    resetStripeClientForTests();
    stripeMocks.customersCreate.mockReset();
    stripeMocks.customersDel.mockReset();
    stripeMocks.checkoutCreate.mockReset();
    stripeMocks.portalCreate.mockReset();
    stripeMocks.subscriptionsRetrieve.mockReset();
  });

  afterEach(() => {
    clearBillingEnv();
    resetStripeClientForTests();
  });

  it("keeps Free usable without Stripe and maps configured prices", async () => {
    expect(isSaasBillingConfigured()).toBe(false);
    const org = await ensureOrganizationForUser(userA.id);
    expect(org.planId).toBe("free");
    const context = await resolveOrganizationForUser(userA.id);
    expect(context.effectivePlanId).toBe("free");
    expect(context.entitlements.features.aiAssistant).toBe(false);

    setBillingEnv();
    expect(isSaasBillingConfigured()).toBe(true);
    expect(mapPlanToStripePriceId("pro")).toBe(PRICE_PRO);
    expect(mapStripePriceIdToPlan(PRICE_STARTER)).toBe("starter");
    expect(mapStripePriceIdToPlan("price_unknown")).toBeNull();
  });

  it("creates Stripe customers idempotently for an organization", async () => {
    setBillingEnv();
    stripeMocks.customersCreate.mockResolvedValue({ id: "cus_once" });
    const org = await ensureOrganizationForUser(userA.id);
    const first = await ensureStripeCustomerForOrganization(org, { ownerEmail: "a@example.test" });
    const second = await ensureStripeCustomerForOrganization(first.organization);
    expect(first.stripeCustomerId).toBe("cus_once");
    expect(second.stripeCustomerId).toBe("cus_once");
    expect(stripeMocks.customersCreate).toHaveBeenCalledTimes(1);
  });

  it("requires auth and ignores browser identity/price fields for checkout", async () => {
    setBillingEnv();
    mockSession(null);
    expect(
      (await createCheckout(jsonRequest("POST", "http://localhost/api/billing/checkout", { planId: "pro" }))).status,
    ).toBe(401);

    stripeMocks.customersCreate.mockResolvedValue({ id: "cus_a" });
    stripeMocks.checkoutCreate.mockResolvedValue({
      id: "cs_sub",
      url: "https://checkout.stripe.test/saas",
    });

    mockSession(userA);
    const response = await createCheckout(
      jsonRequest("POST", "http://localhost/api/billing/checkout", {
        planId: "pro",
        ownerId: userB.id,
        organizationId: "foreign",
        priceId: "price_attacker",
        stripeCustomerId: "cus_attacker",
        returnUrl: "https://evil.example",
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const payload = await readJson(response);
    expect(payload).toMatchObject({ data: { url: "https://checkout.stripe.test/saas", planId: "pro" } });

    const args = stripeMocks.checkoutCreate.mock.calls[0]![0];
    expect(args.mode).toBe("subscription");
    expect(args.line_items[0].price).toBe(PRICE_PRO);
    expect(args.customer).toBe("cus_a");
    expect(args.success_url).toContain("/settings?billing=success");
    expect(args.metadata.billingContext).toBe(SAAS_BILLING_CONTEXT);
    expect(args.metadata.ownerUserId).toBe(userA.id);
  });

  it("blocks demo checkout/portal and duplicate active subscriptions", async () => {
    setBillingEnv();
    await markDemoUser();
    mockSession(demoUser);
    const demoCheckout = await createCheckout(
      jsonRequest("POST", "http://localhost/api/billing/checkout", { planId: "pro" }),
    );
    expect(demoCheckout.status).toBe(403);
    expect(await readJson(demoCheckout)).toMatchObject({ code: "DEMO_BILLING_BLOCKED" });

    stripeMocks.customersCreate.mockResolvedValue({ id: "cus_dup" });
    const org = await ensureOrganizationForUser(userA.id);
    await getOrganizationsCollection().updateOne(
      { ownerUserId: userA.id },
      { $set: { stripeCustomerId: "cus_dup" } },
    );
    await getSubscriptionsCollection().insertOne({
      organizationId: org._id!,
      planId: "pro",
      provider: "stripe",
      stripeCustomerId: "cus_dup",
      stripeSubscriptionId: "sub_existing",
      stripePriceId: PRICE_PRO,
      status: "active",
      cancelAtPeriodEnd: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockSession(userA);
    const dup = await createCheckout(jsonRequest("POST", "http://localhost/api/billing/checkout", { planId: "business" }));
    expect(dup.status).toBe(409);
    expect(await readJson(dup)).toMatchObject({ code: "SUBSCRIPTION_ALREADY_EXISTS" });
  });

  it("creates portal sessions from session-owned Stripe customer only", async () => {
    setBillingEnv();
    mockSession(null);
    expect((await createPortal(jsonRequest("POST", "http://localhost/api/billing/portal", {}))).status).toBe(401);

    stripeMocks.customersCreate.mockResolvedValue({ id: "cus_portal" });
    stripeMocks.portalCreate.mockResolvedValue({ url: "https://billing.stripe.test/portal" });
    mockSession(userA);
    const response = await createPortal(
      jsonRequest("POST", "http://localhost/api/billing/portal", {
        stripeCustomerId: "cus_attacker",
        returnUrl: "https://evil.example",
      }),
    );
    expect(response.status).toBe(200);
    const args = stripeMocks.portalCreate.mock.calls[0]![0];
    expect(args.customer).toBe("cus_portal");
    expect(args.return_url).toBe("http://localhost:3000/settings");
  });

  it("syncs subscription webhooks to organization plan and rejects unknown prices/customers", async () => {
    setBillingEnv();
    const org = await ensureOrganizationForUser(userA.id);
    await getOrganizationsCollection().updateOne(
      { ownerUserId: userA.id },
      { $set: { stripeCustomerId: "cus_sync" } },
    );

    const ok = await syncStripeSubscription(
      stripeSubscription({
        id: "sub_sync",
        customer: "cus_sync",
        metadata: { organizationId: org._id!.toHexString(), billingContext: SAAS_BILLING_CONTEXT },
      }),
    );
    expect(ok.ok).toBe(true);

    const updated = await getOrganizationsCollection().findOne({ ownerUserId: userA.id });
    expect(updated?.planId).toBe("pro");
    const sub = await getSubscriptionsCollection().findOne({ organizationId: org._id });
    expect(sub?.status).toBe("active");
    expect(sub?.planId).toBe("pro");

    const unknownPrice = await syncStripeSubscription(
      stripeSubscription({
        id: "sub_bad_price",
        customer: "cus_sync",
        items: {
          object: "list",
          data: [{ id: "si_x", object: "subscription_item", price: { id: "price_unknown", object: "price" } }],
        } as Stripe.Subscription["items"],
      }),
    );
    expect(unknownPrice.ok).toBe(true);
    const afterUnknown = await getOrganizationsCollection().findOne({ ownerUserId: userA.id });
    expect(afterUnknown?.planId).toBe("free");

    const foreign = await syncStripeSubscription(
      stripeSubscription({ id: "sub_foreign", customer: "cus_other_org" }),
    );
    expect(foreign.ignored).toBe(true);
  });

  it("applies entitlement policy for canceled and past_due subscriptions", async () => {
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const past = new Date(Date.now() - 1000);
    expect(
      resolveEffectivePlanId(
        { planId: "free" },
        {
          organizationId: new ObjectId(),
          planId: "business",
          provider: "stripe",
          stripeCustomerId: "cus_x",
          stripeSubscriptionId: "sub_x",
          stripePriceId: PRICE_BUSINESS,
          status: "past_due",
          cancelAtPeriodEnd: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ),
    ).toBe("business");

    expect(
      resolveEffectivePlanId(
        { planId: "pro" },
        {
          organizationId: new ObjectId(),
          planId: "pro",
          provider: "stripe",
          stripeCustomerId: "cus_x",
          stripeSubscriptionId: "sub_x",
          stripePriceId: PRICE_PRO,
          status: "canceled",
          cancelAtPeriodEnd: true,
          currentPeriodEnd: future,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ),
    ).toBe("pro");

    expect(
      resolveEffectivePlanId(
        { planId: "pro" },
        {
          organizationId: new ObjectId(),
          planId: "pro",
          provider: "stripe",
          stripeCustomerId: "cus_x",
          stripeSubscriptionId: "sub_x",
          stripePriceId: PRICE_PRO,
          status: "canceled",
          cancelAtPeriodEnd: false,
          currentPeriodEnd: past,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ),
    ).toBe("free");

    expect(
      resolveEffectivePlanId(
        { planId: "pro" },
        {
          organizationId: new ObjectId(),
          planId: "pro",
          provider: "stripe",
          stripeCustomerId: "cus_x",
          stripeSubscriptionId: "sub_x",
          stripePriceId: PRICE_PRO,
          status: "unpaid",
          cancelAtPeriodEnd: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ),
    ).toBe("free");
  });

  it("handles SaaS checkout webhook and leaves invoice payment webhooks independent", async () => {
    setBillingEnv();
    const org = await ensureOrganizationForUser(userA.id);
    await getOrganizationsCollection().updateOne(
      { ownerUserId: userA.id },
      { $set: { stripeCustomerId: "cus_hook" } },
    );

    stripeMocks.subscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({
        id: "sub_from_checkout",
        customer: "cus_hook",
        metadata: { organizationId: org._id!.toHexString(), billingContext: SAAS_BILLING_CONTEXT },
      }),
    );

    const saasEvent = {
      id: "evt_saas_checkout_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_saas",
          object: "checkout.session",
          mode: "subscription",
          subscription: "sub_from_checkout",
          metadata: {
            billingContext: SAAS_BILLING_CONTEXT,
            organizationId: org._id!.toHexString(),
            planId: "pro",
          },
        },
      },
    } as unknown as Stripe.Event;

    const first = await handleStripeWebhookEvent(saasEvent);
    expect(first.httpStatus).toBe(200);
    const second = await handleStripeWebhookEvent(saasEvent);
    expect(second.body.duplicate).toBe(true);

    const orgAfter = await getOrganizationsCollection().findOne({ ownerUserId: userA.id });
    expect(orgAfter?.planId).toBe("pro");

    // Invoice payment context must still be ignored by SaaS path (mode payment).
    const invoiceEvent = {
      id: "evt_invoice_checkout_ignore_saas",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_invoice",
          object: "checkout.session",
          mode: "payment",
          payment_status: "unpaid",
          metadata: { paymentContext: STRIPE_PAYMENT_CONTEXT },
        },
      },
    } as unknown as Stripe.Event;
    const invoiceResult = await handleStripeWebhookEvent(invoiceEvent);
    expect(invoiceResult.httpStatus).toBe(200);
    expect(invoiceResult.body.ignored).toBe(true);
  });

  it("exposes billing status on organization API without secrets or Stripe IDs", async () => {
    setBillingEnv();
    mockSession(userA);
    const response = await getOrganization(jsonRequest("GET", "http://localhost/api/organization"));
    expect(response.status).toBe(200);
    const payload = await readJson(response);
    expect(payload).toMatchObject({
      data: {
        plan: { id: "free" },
        billing: { subscriptionBilling: "configured" },
        subscription: { status: "none" },
      },
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/sk_test|whsec_|cus_|ownerUserId|STRIPE_SECRET/);
  });
});
