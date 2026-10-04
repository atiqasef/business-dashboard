import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import {
  GET as getPortalLink,
  POST as createPortalLink,
  DELETE as revokePortalLinkApi,
} from "@/server/api/invoice-portal-link";
import { GET as listPortal } from "@/server/api/public-portal";
import { GET as downloadPortalPdf } from "@/server/api/public-portal-pdf";
import { POST as portalCheckout } from "@/server/api/public-portal-checkout";
import { getCustomerPortalAccessCollection } from "@/server/db/models/customer-portal-access";
import { getInvoicesCollection } from "@/server/db/models/invoice";
import {
  createOrRegeneratePortalLink,
  CUSTOMER_PORTAL_ACCESS_TTL_DAYS,
  generateCustomerPortalNonce,
  getPortalInvoiceByNumber,
  hashCustomerPortalToken,
  listPortalInvoices,
  resolveCustomerPortalByToken,
  revokePortalLinkForInvoice,
} from "@/server/portal/access";
import { createOrRegeneratePublicLink, resolvePublicInvoiceByToken } from "@/server/invoices/public-access";
import { resetStripeClientForTests } from "@/server/payments/providers/stripe-client";
import { createInvoiceFromOrder } from "../helpers/billing";
import { demoUser, mockSession, userA, userB } from "../helpers/auth";
import { markDemoUser, seedCustomer, seedOrder, seedProduct } from "../helpers/fixtures";
import { jsonRequest, params, readJson } from "../helpers/http";

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
      webhooks: { constructEvent: () => ({}) },
    }),
  };
});

function tokenParams(token: string) {
  return { params: Promise.resolve({ token }) };
}

function invoiceParams(token: string, invoiceNumber: string) {
  return { params: Promise.resolve({ token, invoiceNumber }) };
}

beforeEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  resetStripeClientForTests();
  stripeSessionsCreate.mockReset();
});

async function seedTwoCustomersWithInvoices() {
  const customerA = await seedCustomer(userA.id, {
    firstName: "Alice",
    lastName: "OwnerA",
    email: `alice-${new ObjectId().toHexString().slice(-6)}@example.test`,
  });
  const customerB = await seedCustomer(userA.id, {
    firstName: "Bob",
    lastName: "OwnerA",
    email: `bob-${new ObjectId().toHexString().slice(-6)}@example.test`,
  });
  const product = await seedProduct(userA.id, { price: 25 });
  const orderA = await seedOrder(userA.id, customerA._id, product._id);
  const orderB = await seedOrder(userA.id, customerB._id, product._id);
  const invoiceA = await createInvoiceFromOrder(userA, orderA.id, { tax: 0 });
  const invoiceB = await createInvoiceFromOrder(userA, orderB.id, { tax: 1 });

  const foreignCustomer = await seedCustomer(userB.id, {
    firstName: "Alice",
    lastName: "OwnerB",
    email: customerA.email,
  });
  const foreignProduct = await seedProduct(userB.id, { price: 25 });
  const foreignOrder = await seedOrder(userB.id, foreignCustomer._id, foreignProduct._id);
  const foreignInvoice = await createInvoiceFromOrder(userB, foreignOrder.id);

  return {
    customerA,
    customerB,
    invoiceAId: String(invoiceA.data?.id),
    invoiceANumber: String(invoiceA.data?.invoiceNumber),
    invoiceBId: String(invoiceB.data?.id),
    invoiceBNumber: String(invoiceB.data?.invoiceNumber),
    foreignInvoiceId: String(foreignInvoice.data?.id),
    foreignInvoiceNumber: String(foreignInvoice.data?.invoiceNumber),
  };
}

describe("customer portal token lifecycle", () => {
  it("creates URL-safe tokens, stores only the hash, and supports revoke/regenerate", async () => {
    const nonce = generateCustomerPortalNonce();
    expect(nonce.length).toBeGreaterThanOrEqual(40);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(CUSTOMER_PORTAL_ACCESS_TTL_DAYS).toBe(30);

    const seeded = await seedTwoCustomersWithInvoices();
    const created = await createOrRegeneratePortalLink(userA.id, seeded.invoiceAId);
    expect(created.url).toContain("/portal/");
    expect(created.token).toMatch(/^[A-Za-z0-9_-]+$/);

    const stored = await getCustomerPortalAccessCollection().findOne({ ownerId: userA.id });
    expect(stored?.tokenHash).toBe(hashCustomerPortalToken(created.token));
    expect(JSON.stringify(stored)).not.toContain(created.token);
    expect(stored?.customerId.toHexString()).toBe(seeded.customerA._id.toHexString());

    expect((await resolveCustomerPortalByToken(created.token)).ok).toBe(true);

    const regenerated = await createOrRegeneratePortalLink(userA.id, seeded.invoiceAId);
    expect(regenerated.token).not.toBe(created.token);
    expect((await resolveCustomerPortalByToken(created.token)).ok).toBe(false);
    expect((await resolveCustomerPortalByToken(regenerated.token)).ok).toBe(true);

    await revokePortalLinkForInvoice(userA.id, seeded.invoiceAId);
    expect((await resolveCustomerPortalByToken(regenerated.token)).ok).toBe(false);
  });

  it("keeps Phase 12 invoice tokens invoice-scoped (not customer-wide)", async () => {
    const seeded = await seedTwoCustomersWithInvoices();
    const invoiceLink = await createOrRegeneratePublicLink(userA.id, seeded.invoiceAId);
    const portal = await createOrRegeneratePortalLink(userA.id, seeded.invoiceAId);

    const invoiceResolved = await resolvePublicInvoiceByToken(invoiceLink.token);
    expect(invoiceResolved.ok).toBe(true);
    if (invoiceResolved.ok) {
      expect(invoiceResolved.dto.invoiceNumber).toBe(seeded.invoiceANumber);
    }

    // Invoice token cannot list portal invoices.
    await expect(listPortalInvoices(invoiceLink.token)).rejects.toMatchObject({ status: 404 });

    const listed = await listPortalInvoices(portal.token);
    const numbers = listed.data.map((item) => item.invoiceNumber);
    expect(numbers).toContain(seeded.invoiceANumber);
    expect(numbers).not.toContain(seeded.invoiceBNumber);
  });
});

describe("customer portal isolation", () => {
  it("scopes invoices to ownerId + customerId and rejects manipulated identity", async () => {
    const seeded = await seedTwoCustomersWithInvoices();
    const portal = await createOrRegeneratePortalLink(userA.id, seeded.invoiceAId);

    const listed = await listPortalInvoices(portal.token);
    expect(listed.data.map((i) => i.invoiceNumber)).toEqual([seeded.invoiceANumber]);
    expect(JSON.stringify(listed)).not.toContain(userA.id);
    expect(JSON.stringify(listed)).not.toContain(seeded.customerA._id.toHexString());
    expect(JSON.stringify(listed)).not.toContain(seeded.invoiceAId);

    await expect(getPortalInvoiceByNumber(portal.token, seeded.invoiceBNumber)).rejects.toMatchObject({
      status: 404,
    });

    // Same invoice number under another owner must not leak foreign data — lookup is scoped to
    // portal ownerId + customerId, so a colliding number resolves only to this customer's invoice.
    const collided = await getPortalInvoiceByNumber(portal.token, seeded.foreignInvoiceNumber);
    expect(collided.invoice.ownerId).toBe(userA.id);
    expect(collided.invoice.customerId.toHexString()).toBe(seeded.customerA._id.toHexString());
    expect(collided.invoice._id?.toHexString()).toBe(seeded.invoiceAId);

    const response = await listPortal(
      new Request(
        `http://localhost/api/public/portal/${portal.token}?customerId=${seeded.customerB._id.toHexString()}&ownerId=${userB.id}&invoiceId=${seeded.invoiceBId}`,
      ),
      tokenParams(portal.token),
    );
    expect(response.status).toBe(200);
    const payload = await readJson(response);
    expect(((payload?.data as unknown[]) ?? []).map((item) => (item as { invoiceNumber: string }).invoiceNumber)).toEqual([
      seeded.invoiceANumber,
    ]);
  });

  it("blocks PDF and checkout for invoices outside the portal customer", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_portal";
    const seeded = await seedTwoCustomersWithInvoices();
    const portal = await createOrRegeneratePortalLink(userA.id, seeded.invoiceAId);

    const foreignPdf = await downloadPortalPdf(
      jsonRequest("GET", `http://localhost/api/public/portal/${portal.token}/invoices/${seeded.invoiceBNumber}/pdf`),
      invoiceParams(portal.token, seeded.invoiceBNumber),
    );
    expect(foreignPdf.status).toBe(404);

    const foreignCheckout = await portalCheckout(
      jsonRequest("POST", `http://localhost/api/public/portal/${portal.token}/invoices/${seeded.invoiceBNumber}/checkout`, {
        amount: 1,
        ownerId: userB.id,
      }),
      invoiceParams(portal.token, seeded.invoiceBNumber),
    );
    expect(foreignCheckout.status).toBe(404);
    expect(stripeSessionsCreate).not.toHaveBeenCalled();

    stripeSessionsCreate.mockResolvedValue({
      id: "cs_portal",
      url: "https://checkout.stripe.com/c/pay/cs_portal",
    });
    const ownCheckout = await portalCheckout(
      jsonRequest("POST", `http://localhost/api/public/portal/${portal.token}/invoices/${seeded.invoiceANumber}/checkout`, {
        amount: 1,
      }),
      invoiceParams(portal.token, seeded.invoiceANumber),
    );
    expect(ownCheckout.status).toBe(200);
    const args = stripeSessionsCreate.mock.calls[0]?.[0] as { metadata: { invoiceId: string } };
    expect(args.metadata.invoiceId).toBe(seeded.invoiceAId);
  });
});

describe("customer portal list pagination and filters", () => {
  it("paginates, filters, searches, and rejects unsafe inputs", async () => {
    const customer = await seedCustomer(userA.id, { email: `pager-${new ObjectId().toHexString().slice(-6)}@example.test` });
    const product = await seedProduct(userA.id, { price: 10 });

    for (let i = 0; i < 3; i += 1) {
      const order = await seedOrder(userA.id, customer._id, product._id);
      await createInvoiceFromOrder(userA, order.id);
    }

    const invoices = await getInvoicesCollection()
      .find({ ownerId: userA.id, customerId: customer._id })
      .sort({ createdAt: -1 })
      .toArray();
    expect(invoices.length).toBe(3);

    const portal = await createOrRegeneratePortalLink(userA.id, invoices[0]!._id!.toHexString());

    const page1 = await listPortalInvoices(portal.token, { page: 1, pageSize: 2, sort: "newest" });
    expect(page1.data).toHaveLength(2);
    expect(page1.pagination.total).toBe(3);
    expect(page1.pagination.totalPages).toBe(2);

    const page2 = await listPortalInvoices(portal.token, { page: 2, pageSize: 2, sort: "newest" });
    expect(page2.data).toHaveLength(1);

    const oversized = await listPortalInvoices(portal.token, { pageSize: 999 });
    expect(oversized.pagination.pageSize).toBe(50);

    const search = await listPortalInvoices(portal.token, { search: invoices[0]!.invoiceNumber });
    expect(search.data).toHaveLength(1);
    expect(search.data[0]?.invoiceNumber).toBe(invoices[0]!.invoiceNumber);

    await expect(listPortalInvoices(portal.token, { status: "hacked" })).rejects.toMatchObject({ status: 400 });
    await expect(listPortalInvoices(portal.token, { search: "$where" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("customer portal owner and demo management", () => {
  it("allows owners to manage own portal links and blocks demo mutations", async () => {
    const seeded = await seedTwoCustomersWithInvoices();

    mockSession(userB);
    expect(
      (
        await createPortalLink(
          jsonRequest("POST", `http://localhost/api/invoices/${seeded.invoiceAId}/portal-link`),
          params(seeded.invoiceAId),
        )
      ).status,
    ).toBe(404);

    mockSession(userA);
    const created = await createPortalLink(
      jsonRequest("POST", `http://localhost/api/invoices/${seeded.invoiceAId}/portal-link`),
      params(seeded.invoiceAId),
    );
    expect(created.status).toBe(200);
    const createdPayload = await readJson(created);
    expect((createdPayload?.data as { url?: string }).url).toContain("/portal/");

    await markDemoUser();
    const demoCustomer = await seedCustomer(demoUser.id, { email: "demo-portal@example.test" });
    const demoProduct = await seedProduct(demoUser.id, { price: 12 });
    const demoOrder = await seedOrder(demoUser.id, demoCustomer._id, demoProduct._id);
    const now = new Date();
    const demoInvoiceId = new ObjectId();
    await getInvoicesCollection().insertOne({
      _id: demoInvoiceId,
      ownerId: demoUser.id,
      invoiceNumber: "INV-DEMO-PORTAL",
      orderId: demoOrder._id,
      customerId: demoCustomer._id,
      customerSnapshot: { name: "Demo", email: "demo-portal@example.test" },
      items: [{ productId: demoProduct._id, productName: demoProduct.name, quantity: 1, unitPrice: 12, lineTotal: 12 }],
      subtotal: 12,
      discount: 0,
      tax: 0,
      total: 12,
      paidAmount: 0,
      outstandingAmount: 12,
      issueDate: now,
      status: "issued",
      createdAt: now,
      updatedAt: now,
    });

    mockSession(demoUser);
    const demoCreate = await createPortalLink(
      jsonRequest("POST", `http://localhost/api/invoices/${demoInvoiceId.toHexString()}/portal-link`),
      params(demoInvoiceId.toHexString()),
    );
    expect(demoCreate.status).toBe(403);

    const demoGet = await getPortalLink(
      jsonRequest("GET", `http://localhost/api/invoices/${demoInvoiceId.toHexString()}/portal-link`),
      params(demoInvoiceId.toHexString()),
    );
    expect(demoGet.status).toBe(200);

    const demoRevoke = await revokePortalLinkApi(
      jsonRequest("DELETE", `http://localhost/api/invoices/${demoInvoiceId.toHexString()}/portal-link`),
      params(demoInvoiceId.toHexString()),
    );
    expect(demoRevoke.status).toBe(403);
  });
});
