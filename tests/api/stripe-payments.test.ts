import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import Stripe from "stripe";
import { POST as createCheckout } from "@/server/api/public-invoice-checkout";
import { POST as stripeWebhook } from "@/server/api/stripe-webhook";
import { getInvoicesCollection } from "@/server/db/models/invoice";
import { getPaymentsCollection } from "@/server/db/models/payment";
import { getStripeEventsCollection } from "@/server/db/models/stripe-event";
import { createOrRegeneratePublicLink, resolvePublicInvoiceByToken } from "@/server/invoices/public-access";
import { dollarsToStripeCents, stripeCentsToDollars } from "@/server/payments/money";
import { resetStripeClientForTests } from "@/server/payments/providers/stripe-client";
import { STRIPE_PAYMENT_CONTEXT } from "@/server/payments/providers/stripe-provider";
import { normalizeMoney } from "@/server/invoices/status";
import { createInvoiceFromOrder, createPaymentForInvoice } from "../helpers/billing";
import { demoUser, userA } from "../helpers/auth";
import { markDemoUser, seedCustomer, seedOrder, seedProduct } from "../helpers/fixtures";
import { jsonRequest, readJson } from "../helpers/http";

const stripeSessionsCreate = vi.fn();

vi.mock("@/server/payments/providers/stripe-client", async () => {
  const actual = await vi.importActual<typeof import("@/server/payments/providers/stripe-client")>(
    "@/server/payments/providers/stripe-client",
  );
  return {
    ...actual,
    getStripeClient: () => ({
      checkout: {
        sessions: {
          create: stripeSessionsCreate,
          expire: vi.fn().mockResolvedValue({ id: "cs_expired", status: "expired" }),
        },
      },
      webhooks: {
        constructEvent: (body: string, signature: string, secret: string) =>
          Stripe.webhooks.constructEvent(body, signature, secret),
      },
    }),
  };
});

function tokenParams(token: string) {
  return { params: Promise.resolve({ token }) };
}

function signedWebhookRequest(event: Stripe.Event, secret: string) {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
  });
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
    body: payload,
  });
}

describe("stripe amount conversion", () => {
  it("converts whole, decimal, and outstanding amounts safely", () => {
    expect(dollarsToStripeCents(100)).toBe(10000);
    expect(dollarsToStripeCents(12.34)).toBe(1234);
    expect(dollarsToStripeCents(0.01)).toBe(1);
    expect(stripeCentsToDollars(10000)).toBe(100);
    expect(stripeCentsToDollars(1234)).toBe(12.34);
    expect(() => dollarsToStripeCents(0)).toThrow(/greater than zero/);
    expect(() => dollarsToStripeCents(-5)).toThrow(/greater than zero/);
  });
});

describe("stripe checkout creation", () => {
  beforeEach(() => {
    resetStripeClientForTests();
    stripeSessionsCreate.mockReset();
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    resetStripeClientForTests();
  });

  async function createPayableInvoice() {
    const customer = await seedCustomer(userA.id, {
      email: `pay-${new ObjectId().toHexString().slice(-8)}@example.test`,
    });
    const product = await seedProduct(userA.id, { price: 40 });
    const order = await seedOrder(userA.id, customer._id, product._id);
    const invoice = await createInvoiceFromOrder(userA, order.id, { tax: 2 });
    const invoiceId = String(invoice.data?.id);
    const link = await createOrRegeneratePublicLink(userA.id, invoiceId);
    return { invoiceId, token: link.token, outstanding: Number(invoice.data?.outstandingAmount) };
  }

  it("creates a checkout session from a valid public token using server-side amount", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_checkout";
    const { token, invoiceId, outstanding } = await createPayableInvoice();
    stripeSessionsCreate.mockResolvedValue({
      id: "cs_test_123",
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
    });

    const response = await createCheckout(
      jsonRequest("POST", `http://localhost/api/public/invoices/${token}/checkout`, {
        amount: 1,
        ownerId: "attacker",
        invoiceId: "000000000000000000000099",
        currency: "eur",
      }),
      tokenParams(token),
    );

    expect(response.status).toBe(200);
    const payload = await readJson(response);
    expect(payload).toEqual({
      data: { checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_123" },
    });

    expect(stripeSessionsCreate).toHaveBeenCalledTimes(1);
    const args = stripeSessionsCreate.mock.calls[0]?.[0] as {
      line_items: Array<{ price_data: { unit_amount: number; currency: string } }>;
      metadata: Record<string, string>;
      success_url: string;
      cancel_url: string;
    };
    expect(args.line_items[0]?.price_data.unit_amount).toBe(dollarsToStripeCents(outstanding));
    expect(args.line_items[0]?.price_data.currency).toBe("usd");
    expect(args.metadata.ownerId).toBe(userA.id);
    expect(args.metadata.invoiceId).toBe(invoiceId);
    expect(args.metadata.paymentContext).toBe(STRIPE_PAYMENT_CONTEXT);
    expect(args.success_url).toContain(`/invoice/${token}?payment=success`);
    expect(args.cancel_url).toContain(`/invoice/${token}?payment=cancelled`);
    expect(JSON.stringify(args.metadata)).not.toContain(token);
  });

  it("rejects invalid, expired, revoked, paid, and cancelled invoices", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_checkout";
    const { token, invoiceId } = await createPayableInvoice();

    expect(
      (
        await createCheckout(
          jsonRequest("POST", "http://localhost/api/public/invoices/bad-token-value/checkout", {}),
          tokenParams("bad-token-value-here"),
        )
      ).status,
    ).toBe(404);

    await getInvoicesCollection().updateOne({ _id: new ObjectId(invoiceId) }, { $set: { status: "cancelled" } });
    // token still valid access-wise, but invoice cancelled
    const cancelled = await createCheckout(
      jsonRequest("POST", `http://localhost/api/public/invoices/${token}/checkout`, {}),
      tokenParams(token),
    );
    expect(cancelled.status).toBe(409);

    const fresh = await createPayableInvoice();
    await createPaymentForInvoice(userA, fresh.invoiceId, Number((await getInvoicesCollection().findOne({ _id: new ObjectId(fresh.invoiceId) }))?.outstandingAmount));
    const paid = await createCheckout(
      jsonRequest("POST", `http://localhost/api/public/invoices/${fresh.token}/checkout`, {}),
      tokenParams(fresh.token),
    );
    expect(paid.status).toBe(409);

    const revokedLink = await createPayableInvoice();
    const { revokePublicLink } = await import("@/server/invoices/public-access");
    await revokePublicLink(userA.id, revokedLink.invoiceId);
    const revoked = await createCheckout(
      jsonRequest("POST", `http://localhost/api/public/invoices/${revokedLink.token}/checkout`, {}),
      tokenParams(revokedLink.token),
    );
    expect(revoked.status).toBe(404);
  });

  it("returns 503 when Stripe is not configured and blocks demo checkout", async () => {
    const { token } = await createPayableInvoice();
    const unconfigured = await createCheckout(
      jsonRequest("POST", `http://localhost/api/public/invoices/${token}/checkout`, {}),
      tokenParams(token),
    );
    expect(unconfigured.status).toBe(503);

    await markDemoUser();
    process.env.STRIPE_SECRET_KEY = "sk_test_demo";
    const customer = await seedCustomer(demoUser.id, { email: "demo-pay@example.test" });
    const product = await seedProduct(demoUser.id, { price: 15 });
    const order = await seedOrder(demoUser.id, customer._id, product._id);
    const now = new Date();
    const invoiceId = new ObjectId();
    await getInvoicesCollection().insertOne({
      _id: invoiceId,
      ownerId: demoUser.id,
      invoiceNumber: "INV-DEMO-PAY",
      orderId: order._id,
      customerId: customer._id,
      customerSnapshot: { name: "Demo", email: "demo-pay@example.test" },
      items: [{ productId: product._id, productName: product.name, quantity: 1, unitPrice: 15, lineTotal: 15 }],
      subtotal: 15,
      discount: 0,
      tax: 0,
      total: 15,
      paidAmount: 0,
      outstandingAmount: 15,
      issueDate: now,
      status: "issued",
      createdAt: now,
      updatedAt: now,
    });
    const link = await createOrRegeneratePublicLink(demoUser.id, invoiceId.toHexString());
    const demoCheckout = await createCheckout(
      jsonRequest("POST", `http://localhost/api/public/invoices/${link.token}/checkout`, {}),
      tokenParams(link.token),
    );
    expect(demoCheckout.status).toBe(403);
    expect(stripeSessionsCreate).not.toHaveBeenCalled();

    const resolved = await resolvePublicInvoiceByToken(link.token);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.dto.payment.canPay).toBe(false);
      expect(resolved.dto.payment.message).toMatch(/demo/i);
    }
  });
});

describe("stripe webhook processing", () => {
  const webhookSecret = "whsec_test_secret";

  beforeEach(() => {
    resetStripeClientForTests();
    stripeSessionsCreate.mockReset();
    process.env.STRIPE_SECRET_KEY = "sk_test_webhook";
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
  });

  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    resetStripeClientForTests();
  });

  async function seedOpenInvoice() {
    const customer = await seedCustomer(userA.id, { email: "hook@example.test" });
    const product = await seedProduct(userA.id, { price: 50 });
    const order = await seedOrder(userA.id, customer._id, product._id);
    const invoice = await createInvoiceFromOrder(userA, order.id, { tax: 0 });
    return {
      invoiceId: String(invoice.data?.id),
      outstanding: Number(invoice.data?.outstandingAmount),
    };
  }

  function completedEvent(options: {
    eventId: string;
    invoiceId: string;
    amountCents: number;
    paymentIntentId: string;
    paymentStatus?: string;
    currency?: string;
    ownerId?: string;
  }): Stripe.Event {
    return {
      id: options.eventId,
      object: "event",
      api_version: null,
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_completed",
          object: "checkout.session",
          mode: "payment",
          payment_status: options.paymentStatus ?? "paid",
          currency: options.currency ?? "usd",
          amount_total: options.amountCents,
          payment_intent: options.paymentIntentId,
          metadata: {
            ownerId: options.ownerId ?? userA.id,
            invoiceId: options.invoiceId,
            paymentContext: STRIPE_PAYMENT_CONTEXT,
          },
        } as unknown as Stripe.Checkout.Session,
      },
    } as Stripe.Event;
  }

  it("rejects missing/invalid signatures and missing webhook configuration", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const bare = await stripeWebhook(
      new Request("http://localhost/api/webhooks/stripe", { method: "POST", body: "{}" }),
    );
    expect(bare.status).toBe(503);

    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    const missingSig = await stripeWebhook(
      new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "evt_1" }),
      }),
    );
    expect(missingSig.status).toBe(400);

    const invalid = await stripeWebhook(
      new Request("http://localhost/api/webhooks/stripe", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": "t=1,v1=deadbeef",
        },
        body: JSON.stringify({ id: "evt_1" }),
      }),
    );
    expect(invalid.status).toBe(400);
  });

  it("records a verified checkout payment and is idempotent", async () => {
    const { invoiceId, outstanding } = await seedOpenInvoice();
    const amountCents = dollarsToStripeCents(outstanding);
    const event = completedEvent({
      eventId: "evt_paid_1",
      invoiceId,
      amountCents,
      paymentIntentId: "pi_test_abc123",
    });

    const first = await stripeWebhook(signedWebhookRequest(event, webhookSecret));
    expect(first.status).toBe(200);
    expect(await readJson(first)).toMatchObject({ received: true });

    const payments = await getPaymentsCollection().find({ ownerId: userA.id }).toArray();
    expect(payments).toHaveLength(1);
    expect(payments[0]?.paymentMethod).toBe("stripe");
    expect(payments[0]?.provider).toBe("stripe");
    expect(payments[0]?.providerPaymentId).toBe("pi_test_abc123");
    expect(payments[0]?.amount).toBe(outstanding);
    expect(payments[0]?.reference).toBe("pi_test_abc123");

    const invoice = await getInvoicesCollection().findOne({ _id: new ObjectId(invoiceId) });
    expect(invoice?.outstandingAmount).toBe(0);
    expect(invoice?.status).toBe("paid");

    const second = await stripeWebhook(signedWebhookRequest(event, webhookSecret));
    expect(second.status).toBe(200);
    expect(await getPaymentsCollection().countDocuments({ ownerId: userA.id })).toBe(1);
    expect(await getStripeEventsCollection().countDocuments({ eventId: "evt_paid_1" })).toBe(1);

    // Different event, same PaymentIntent — still one payment.
    const replay = completedEvent({
      eventId: "evt_paid_2",
      invoiceId,
      amountCents,
      paymentIntentId: "pi_test_abc123",
    });
    const third = await stripeWebhook(signedWebhookRequest(replay, webhookSecret));
    expect(third.status).toBe(200);
    expect(await getPaymentsCollection().countDocuments({ ownerId: userA.id })).toBe(1);
  });

  it("rejects overpayment/currency mismatches and ignores unpaid sessions", async () => {
    const { invoiceId, outstanding } = await seedOpenInvoice();

    // Amount above current outstanding must never auto-apply (stale full-balance Checkout).
    const overpay = await stripeWebhook(
      signedWebhookRequest(
        completedEvent({
          eventId: "evt_wrong_amount",
          invoiceId,
          amountCents: dollarsToStripeCents(outstanding) + 1,
          paymentIntentId: "pi_wrong_amount",
        }),
        webhookSecret,
      ),
    );
    expect(overpay.status).toBe(200);
    expect(await getPaymentsCollection().countDocuments({ ownerId: userA.id })).toBe(0);

    const wrongCurrency = await stripeWebhook(
      signedWebhookRequest(
        completedEvent({
          eventId: "evt_wrong_currency",
          invoiceId,
          amountCents: dollarsToStripeCents(outstanding),
          paymentIntentId: "pi_wrong_currency",
          currency: "eur",
        }),
        webhookSecret,
      ),
    );
    expect(wrongCurrency.status).toBe(200);
    expect(await getPaymentsCollection().countDocuments({ ownerId: userA.id })).toBe(0);

    const unpaid = await stripeWebhook(
      signedWebhookRequest(
        completedEvent({
          eventId: "evt_unpaid",
          invoiceId,
          amountCents: dollarsToStripeCents(outstanding),
          paymentIntentId: "pi_unpaid",
          paymentStatus: "unpaid",
        }),
        webhookSecret,
      ),
    );
    expect(unpaid.status).toBe(200);
    expect((await readJson(unpaid))?.ignored).toBe(true);
    expect(await getPaymentsCollection().countDocuments({ ownerId: userA.id })).toBe(0);
  });

  it("applies Stripe underpayments up to current outstanding after a partial manual pay", async () => {
    const { invoiceId, outstanding } = await seedOpenInvoice();
    const partial = Math.max(0.01, normalizeMoney(outstanding / 2));
    await createPaymentForInvoice(userA, invoiceId, partial);

    const remaining = normalizeMoney(outstanding - partial);
    const underpayAmount = normalizeMoney(Math.max(0.01, remaining - 1));
    const event = completedEvent({
      eventId: "evt_underpay",
      invoiceId,
      amountCents: dollarsToStripeCents(underpayAmount),
      paymentIntentId: "pi_underpay",
    });

    const response = await stripeWebhook(signedWebhookRequest(event, webhookSecret));
    expect(response.status).toBe(200);
    expect(await getPaymentsCollection().countDocuments({ ownerId: userA.id, provider: "stripe" })).toBe(1);

    const invoice = await getInvoicesCollection().findOne({ _id: new ObjectId(invoiceId) });
    expect(invoice?.paidAmount).toBe(normalizeMoney(partial + underpayAmount));
    expect(invoice?.outstandingAmount).toBe(normalizeMoney(outstanding - partial - underpayAmount));
  });

  it("does not mark invoices paid from return URLs and ignores irrelevant events", async () => {
    const { invoiceId } = await seedOpenInvoice();
    const before = await getInvoicesCollection().findOne({ _id: new ObjectId(invoiceId) });
    expect(before?.status).not.toBe("paid");

    const irrelevant: Stripe.Event = {
      id: "evt_ping",
      object: "event",
      api_version: null,
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 0,
      request: null,
      type: "ping",
      data: { object: {} as never },
    } as Stripe.Event;

    const response = await stripeWebhook(signedWebhookRequest(irrelevant, webhookSecret));
    expect(response.status).toBe(200);
    expect((await readJson(response))?.ignored).toBe(true);

    const after = await getInvoicesCollection().findOne({ _id: new ObjectId(invoiceId) });
    expect(after?.paidAmount).toBe(before?.paidAmount);
    expect(after?.status).toBe(before?.status);
  });
});
