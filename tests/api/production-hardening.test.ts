import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { DELETE as voidPayment } from "@/server/api/payments";
import { GET as getPublicLink } from "@/server/api/invoice-public-link";
import { getInvoiceAccessCollection } from "@/server/db/models/invoice-access";
import { getCustomerPortalAccessCollection } from "@/server/db/models/customer-portal-access";
import { getInvoicesCollection } from "@/server/db/models/invoice";
import { getPaymentsCollection } from "@/server/db/models/payment";
import { getStripeEventsCollection } from "@/server/db/models/stripe-event";
import {
  createOrRegeneratePublicLink,
  hashInvoiceAccessToken,
  resolvePublicInvoiceByToken,
} from "@/server/invoices/public-access";
import {
  createOrRegeneratePortalLink,
  hashCustomerPortalToken,
  listPortalInvoices,
  resolveCustomerPortalByToken,
} from "@/server/portal/access";
import { handleStripeWebhookEvent } from "@/server/payments/stripe-webhook";
import { STRIPE_PAYMENT_CONTEXT } from "@/server/payments/providers/stripe-provider";
import { createInvoiceFromOrder, createPaymentForInvoice } from "../helpers/billing";
import { mockSession, userA } from "../helpers/auth";
import { seedCustomer, seedOrder, seedProduct } from "../helpers/fixtures";
import { jsonRequest, params, readJson } from "../helpers/http";
import type Stripe from "stripe";

vi.mock("@/server/payments/providers/stripe-client", async () => {
  const actual = await vi.importActual<typeof import("@/server/payments/providers/stripe-client")>(
    "@/server/payments/providers/stripe-client",
  );
  return {
    ...actual,
    getStripeClient: () => ({
      checkout: {
        sessions: {
          create: vi.fn(),
          expire: vi.fn().mockResolvedValue({ id: "cs_expired", status: "expired" }),
        },
      },
      webhooks: { constructEvent: () => ({}) },
    }),
  };
});

describe("production hardening", () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || "test-better-auth-secret";
  });

  async function seedIssuedInvoice(options?: { tax?: number }) {
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id, { price: 100 });
    const order = await seedOrder(userA.id, customer._id, product._id);
    const invoice = await createInvoiceFromOrder(userA, order.id, { tax: options?.tax ?? 0 });
    return {
      customerId: customer._id,
      invoiceId: String(invoice.data?.id),
      invoiceNumber: String(invoice.data?.invoiceNumber),
      outstanding: Number(invoice.data?.outstandingAmount),
    };
  }

  it("blocks voiding Stripe-recorded payments", async () => {
    const { invoiceId, outstanding } = await seedIssuedInvoice();
    const now = new Date();
    const paymentId = new ObjectId();
    await getPaymentsCollection().insertOne({
      _id: paymentId,
      ownerId: userA.id,
      invoiceId: new ObjectId(invoiceId),
      orderId: new ObjectId(),
      customerId: new ObjectId(),
      amount: outstanding,
      paymentMethod: "stripe",
      provider: "stripe",
      providerPaymentId: "pi_hardening_block_void",
      paymentDate: now,
      createdAt: now,
      updatedAt: now,
    });
    await getInvoicesCollection().updateOne(
      { _id: new ObjectId(invoiceId) },
      { $set: { paidAmount: outstanding, outstandingAmount: 0, status: "paid", updatedAt: now } },
    );

    mockSession(userA);
    const response = await voidPayment(
      jsonRequest("DELETE", `http://localhost/api/payments/${paymentId.toHexString()}`),
      params(paymentId.toHexString()),
    );
    expect(response.status).toBe(409);
    expect(await readJson(response)).toMatchObject({
      error: expect.stringMatching(/Stripe payments cannot be voided/i),
    });
    const payment = await getPaymentsCollection().findOne({ _id: paymentId });
    expect(payment?.voidedAt).toBeUndefined();
  });

  it("rejects invoice tax/discount updates that use a stale paidAmount snapshot", async () => {
    const { invoiceId } = await seedIssuedInvoice({ tax: 5 });
    await createPaymentForInvoice(userA, invoiceId, 10);

    const before = await getInvoicesCollection().findOne({ _id: new ObjectId(invoiceId) });
    expect(before).toBeTruthy();

    // Same filter the PATCH handler uses after a concurrent payment changes paidAmount.
    const stalePaid = Number(before!.paidAmount) - 5;
    const raced = await getInvoicesCollection().findOneAndUpdate(
      {
        _id: new ObjectId(invoiceId),
        ownerId: userA.id,
        paidAmount: stalePaid,
        status: { $nin: ["cancelled", "paid"] },
      },
      {
        $set: {
          tax: 8,
          total: Number(before!.subtotal) - Number(before!.discount) + 8,
          outstandingAmount: Number(before!.subtotal) - Number(before!.discount) + 8 - stalePaid,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" },
    );
    expect(raced).toBeNull();

    const after = await getInvoicesCollection().findOne({ _id: new ObjectId(invoiceId) });
    expect(after?.tax).toBe(before?.tax);
    expect(after?.paidAmount).toBe(before?.paidAmount);
  });

  it("reconciles concurrent public-link regenerations to a single active token", async () => {
    const { invoiceId } = await seedIssuedInvoice();
    const [first, second] = await Promise.all([
      createOrRegeneratePublicLink(userA.id, invoiceId),
      createOrRegeneratePublicLink(userA.id, invoiceId),
    ]);

    const active = await getInvoiceAccessCollection()
      .find({
        ownerId: userA.id,
        invoiceId: new ObjectId(invoiceId),
        revokedAt: { $exists: false },
      })
      .toArray();
    expect(active).toHaveLength(1);

    const activeHash = active[0]!.tokenHash;
    const firstHash = hashInvoiceAccessToken(first.token);
    const secondHash = hashInvoiceAccessToken(second.token);
    expect([firstHash, secondHash]).toContain(activeHash);

    const losers = [first.token, second.token].filter((token) => hashInvoiceAccessToken(token) !== activeHash);
    for (const token of losers) {
      const resolved = await resolvePublicInvoiceByToken(token);
      expect(resolved.ok).toBe(false);
    }
  });

  it("reconciles concurrent portal-link regenerations to a single active token", async () => {
    const { invoiceId, customerId } = await seedIssuedInvoice();
    const [first, second] = await Promise.all([
      createOrRegeneratePortalLink(userA.id, invoiceId),
      createOrRegeneratePortalLink(userA.id, invoiceId),
    ]);

    const active = await getCustomerPortalAccessCollection()
      .find({
        ownerId: userA.id,
        customerId,
        revokedAt: { $exists: false },
      })
      .toArray();
    expect(active).toHaveLength(1);

    const activeHash = active[0]!.tokenHash;
    expect([hashCustomerPortalToken(first.token), hashCustomerPortalToken(second.token)]).toContain(activeHash);

    const winner = hashCustomerPortalToken(first.token) === activeHash ? first.token : second.token;
    const loser = winner === first.token ? second.token : first.token;
    expect((await resolveCustomerPortalByToken(winner)).ok).toBe(true);
    expect((await resolveCustomerPortalByToken(loser)).ok).toBe(false);
  });

  it("hides draft invoices from the customer portal list and detail", async () => {
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id, { price: 50 });
    const order = await seedOrder(userA.id, customer._id, product._id);
    const issued = await createInvoiceFromOrder(userA, order.id, { tax: 0 });
    const portal = await createOrRegeneratePortalLink(userA.id, String(issued.data?.id));

    const draftNumber = "INV-DRAFT-HARDEN";
    await getInvoicesCollection().insertOne({
      ownerId: userA.id,
      invoiceNumber: draftNumber,
      orderId: new ObjectId(),
      customerId: customer._id,
      customerSnapshot: { name: "Draft Customer", email: customer.email },
      items: [],
      subtotal: 10,
      discount: 0,
      tax: 0,
      total: 10,
      paidAmount: 0,
      outstandingAmount: 10,
      issueDate: new Date(),
      status: "draft",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const list = await listPortalInvoices(portal.token, { status: "all" });
    expect(list.data.every((row) => row.invoiceNumber !== draftNumber)).toBe(true);
    expect(list.summary.invoiceCount).toBe(1);
  });

  it("sets Cache-Control: no-store on owner public-link responses that may include URLs", async () => {
    const { invoiceId } = await seedIssuedInvoice();
    await createOrRegeneratePublicLink(userA.id, invoiceId);
    mockSession(userA);
    const response = await getPublicLink(
      jsonRequest("GET", `http://localhost/api/invoices/${invoiceId}/public-link`),
      params(invoiceId),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("reclaims stale Stripe webhook processing leases", async () => {
    const { invoiceId, outstanding } = await seedIssuedInvoice();
    const eventId = "evt_stale_processing";
    const staleUpdatedAt = new Date(Date.now() - 5 * 60 * 1000);
    await getStripeEventsCollection().insertOne({
      eventId,
      type: "checkout.session.completed",
      status: "processing",
      createdAt: staleUpdatedAt,
      updatedAt: staleUpdatedAt,
    });

    const event = {
      id: eventId,
      object: "event",
      api_version: null,
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_stale",
          object: "checkout.session",
          mode: "payment",
          payment_status: "paid",
          currency: "usd",
          amount_total: Math.round(outstanding * 100),
          payment_intent: "pi_stale_reclaim",
          metadata: {
            ownerId: userA.id,
            invoiceId,
            paymentContext: STRIPE_PAYMENT_CONTEXT,
          },
        },
      },
    } as unknown as Stripe.Event;

    const result = await handleStripeWebhookEvent(event);
    expect(result.httpStatus).toBe(200);
    expect(await getPaymentsCollection().countDocuments({ providerPaymentId: "pi_stale_reclaim" })).toBe(1);

    const claimed = await getStripeEventsCollection().findOne({ eventId });
    expect(claimed?.status).toBe("processed");
  });
});
