import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { GET as getPublicLink, POST as createPublicLink, DELETE as revokePublicLinkApi } from "@/server/api/invoice-public-link";
import { POST as emailInvoice } from "@/server/api/invoice-email";
import { GET as downloadPublicPdf } from "@/server/api/public-invoice-pdf";
import { sendEmail } from "@/server/email/send-email";
import { getCanonicalAppUrl } from "@/server/config/app-url";
import { getInvoiceAccessCollection } from "@/server/db/models/invoice-access";
import { getInvoicesCollection } from "@/server/db/models/invoice";
import {
  createOrRegeneratePublicLink,
  ensurePublicInvoiceUrl,
  generateInvoiceAccessNonce,
  hashInvoiceAccessToken,
  INVOICE_ACCESS_TTL_DAYS,
  resolvePublicInvoiceByToken,
  revokePublicLink,
} from "@/server/invoices/public-access";
import { getInvoicePaymentProvider } from "@/server/payments/providers/types";
import { createInvoiceFromOrder } from "../helpers/billing";
import { demoUser, mockSession, userA, userB } from "../helpers/auth";
import { markDemoUser, seedCustomer, seedOrder, seedProduct } from "../helpers/fixtures";
import { jsonRequest, params, readJson } from "../helpers/http";

vi.mock("@/server/email/send-email", () => ({
  sendEmail: vi.fn(),
}));

beforeEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

function tokenParams(token: string) {
  return { params: Promise.resolve({ token }) };
}

function extractTokenFromUrl(url: string) {
  const match = url.match(/\/invoice\/([^/?#]+)/);
  expect(match?.[1]).toBeTruthy();
  return match![1]!;
}

describe("invoice public access token generation", () => {
  it("creates URL-safe high-entropy tokens and stores only the hash", async () => {
    const nonce = generateInvoiceAccessNonce();
    expect(nonce.length).toBeGreaterThanOrEqual(40);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);

    const customer = await seedCustomer(userA.id, { email: "portal@example.test" });
    const product = await seedProduct(userA.id, { price: 25 });
    const order = await seedOrder(userA.id, customer._id, product._id);
    const invoice = await createInvoiceFromOrder(userA, order.id);
    const invoiceId = String(invoice.data?.id);

    const created = await createOrRegeneratePublicLink(userA.id, invoiceId);
    expect(created.url).toContain(`${getCanonicalAppUrl()}/invoice/`);
    expect(created.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(created.token.length).toBeGreaterThanOrEqual(40);

    const stored = await getInvoiceAccessCollection().findOne({ ownerId: userA.id });
    expect(stored).toBeTruthy();
    expect(stored?.tokenHash).toBe(hashInvoiceAccessToken(created.token));
    expect(JSON.stringify(stored)).not.toContain(created.token);
    expect((stored as { token?: string } | null)?.token).toBeUndefined();
    expect(INVOICE_ACCESS_TTL_DAYS).toBe(30);
  });
});

describe("invoice public link ownership", () => {
  it("lets an owner create and revoke own links but not another owner's", async () => {
    const customer = await seedCustomer(userA.id, { email: "owner-a@example.test" });
    const product = await seedProduct(userA.id, { price: 40 });
    const order = await seedOrder(userA.id, customer._id, product._id);
    const invoice = await createInvoiceFromOrder(userA, order.id);
    const invoiceId = String(invoice.data?.id);

    mockSession(userB);
    const foreignCreate = await createPublicLink(
      jsonRequest("POST", `http://localhost/api/invoices/${invoiceId}/public-link`),
      params(invoiceId),
    );
    expect(foreignCreate.status).toBe(404);

    mockSession(userA);
    const created = await createPublicLink(
      jsonRequest("POST", `http://localhost/api/invoices/${invoiceId}/public-link`),
      params(invoiceId),
    );
    expect(created.status).toBe(200);
    const createdPayload = await readJson(created);
    const url = String((createdPayload?.data as { url?: string })?.url);
    expect(url).toContain("/invoice/");

    mockSession(userB);
    const foreignRevoke = await revokePublicLinkApi(
      jsonRequest("DELETE", `http://localhost/api/invoices/${invoiceId}/public-link`),
      params(invoiceId),
    );
    expect(foreignRevoke.status).toBe(404);

    mockSession(userA);
    const revoked = await revokePublicLinkApi(
      jsonRequest("DELETE", `http://localhost/api/invoices/${invoiceId}/public-link`),
      params(invoiceId),
    );
    expect(revoked.status).toBe(200);
    const revokedPayload = await readJson(revoked);
    expect((revokedPayload?.data as { status?: string })?.status).toBe("revoked");
    expect(JSON.stringify(revokedPayload)).not.toMatch(/tokenHash|ownerId|nonce/);
  });
});

describe("invoice public portal access", () => {
  it("serves sanitized invoice data for valid tokens and rejects invalid lifecycle states", async () => {
    const customer = await seedCustomer(userA.id, {
      firstName: "Grace",
      lastName: "Hopper",
      email: "grace@example.test",
      company: "Navy Computing",
      address: "1 Pier Way",
      city: "Arlington",
      country: "US",
    });
    const product = await seedProduct(userA.id, { price: 55, name: "Consulting" });
    const order = await seedOrder(userA.id, customer._id, product._id);
    const invoice = await createInvoiceFromOrder(userA, order.id, { tax: 5, notes: "Net 15" });
    const invoiceId = String(invoice.data?.id);

    const created = await createOrRegeneratePublicLink(userA.id, invoiceId);
    const token = created.token;

    const resolved = await resolvePublicInvoiceByToken(token);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const dto = resolved.dto;
    expect(dto.invoiceNumber).toBe(invoice.data?.invoiceNumber);
    expect(dto.customer.name).toContain("Grace");
    expect(dto.business.businessName).toBeTruthy();
    expect(dto.payment.onlinePaymentsAvailable).toBe(false);
    expect(dto.payment.canPay).toBe(false);
    expect(dto.payment.message).toMatch(/not configured/i);

    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain(userA.id);
    expect(serialized).not.toContain(invoiceId);
    expect(serialized).not.toContain("ownerId");
    expect(serialized).not.toMatch(/session|reminder|tokenHash|nonce/);
    expect(dto.items[0]).not.toHaveProperty("productId");

    expect((await resolvePublicInvoiceByToken("not-a-valid-token")).ok).toBe(false);
    expect((await resolvePublicInvoiceByToken("a".repeat(20))).ok).toBe(false);

    const regenerated = await createOrRegeneratePublicLink(userA.id, invoiceId);
    expect(regenerated.token).not.toBe(token);
    expect((await resolvePublicInvoiceByToken(token)).ok).toBe(false);
    expect((await resolvePublicInvoiceByToken(regenerated.token)).ok).toBe(true);

    await revokePublicLink(userA.id, invoiceId);
    expect((await resolvePublicInvoiceByToken(regenerated.token)).ok).toBe(false);
  });

  it("rejects expired and revoked tokens with a generic failure", async () => {
    const customer = await seedCustomer(userA.id, { email: "expiry@example.test" });
    const product = await seedProduct(userA.id, { price: 12 });
    const order = await seedOrder(userA.id, customer._id, product._id);
    const invoice = await createInvoiceFromOrder(userA, order.id);
    const invoiceId = String(invoice.data?.id);

    const created = await createOrRegeneratePublicLink(userA.id, invoiceId);
    const token = created.token;

    await getInvoiceAccessCollection().updateOne(
      { tokenHash: hashInvoiceAccessToken(token) },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } },
    );
    const expired = await resolvePublicInvoiceByToken(token);
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.reason).toBe("expired");

    const fresh = await createOrRegeneratePublicLink(userA.id, invoiceId);
    await revokePublicLink(userA.id, invoiceId);
    const revoked = await resolvePublicInvoiceByToken(fresh.token);
    expect(revoked.ok).toBe(false);
    if (!revoked.ok) expect(revoked.reason).toBe("revoked");
  });
});

describe("invoice public PDF and email integration", () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockReset();
    vi.mocked(sendEmail).mockResolvedValue({ id: "email_portal_1" });
  });

  it("downloads PDF for a valid public token and rejects invalid tokens", async () => {
    const customer = await seedCustomer(userA.id, { email: "pdf@example.test" });
    const product = await seedProduct(userA.id, { price: 30 });
    const order = await seedOrder(userA.id, customer._id, product._id);
    const invoice = await createInvoiceFromOrder(userA, order.id);
    const invoiceId = String(invoice.data?.id);
    const created = await createOrRegeneratePublicLink(userA.id, invoiceId);

    const pdfResponse = await downloadPublicPdf(
      jsonRequest("GET", `http://localhost/invoice/${created.token}/pdf`),
      tokenParams(created.token),
    );
    expect(pdfResponse.status).toBe(200);
    expect(pdfResponse.headers.get("Content-Type")).toBe("application/pdf");
    expect(pdfResponse.headers.get("Cache-Control")).toBe("no-store");
    const bytes = Buffer.from(await pdfResponse.arrayBuffer());
    expect(bytes.subarray(0, 4).toString("utf8")).toBe("%PDF");

    const invalid = await downloadPublicPdf(
      jsonRequest("GET", "http://localhost/invoice/bad-token/pdf"),
      tokenParams("bad-token-value-here"),
    );
    expect(invalid.status).toBe(404);
    expect(await readJson(invalid)).toEqual({ error: "This invoice link is invalid or has expired." });
  });

  it("includes a server-generated public URL in invoice emails and reuses active links", async () => {
    const customer = await seedCustomer(userA.id, { email: "mail-link@example.test" });
    const product = await seedProduct(userA.id, { price: 18 });
    const order = await seedOrder(userA.id, customer._id, product._id);
    const invoice = await createInvoiceFromOrder(userA, order.id);
    const invoiceId = String(invoice.data?.id);

    const firstUrl = await ensurePublicInvoiceUrl(userA.id, invoiceId);
    const secondUrl = await ensurePublicInvoiceUrl(userA.id, invoiceId);
    expect(secondUrl).toBe(firstUrl);
    expect(await getInvoiceAccessCollection().countDocuments({ ownerId: userA.id, invoiceId: new ObjectId(invoiceId) })).toBe(1);

    mockSession(userA);
    const response = await emailInvoice(
      jsonRequest("POST", `http://localhost/api/invoices/${invoiceId}/email`, {}),
      params(invoiceId),
    );
    expect(response.status).toBe(200);

    const payload = vi.mocked(sendEmail).mock.calls[0]?.[0];
    expect(payload?.html).toContain(firstUrl);
    expect(payload?.text).toContain(firstUrl);
    expect(payload?.html).toContain("Open Invoice");
    expect(payload?.html).not.toContain("http://localhost:9999");
    expect(extractTokenFromUrl(firstUrl)).toMatch(/^[A-Za-z0-9_-]+$/);

    // Still a single active access record after email (reuse, no churn).
    expect(
      await getInvoiceAccessCollection().countDocuments({
        ownerId: userA.id,
        invoiceId: new ObjectId(invoiceId),
        revokedAt: { $exists: false },
      }),
    ).toBe(1);
  });
});

describe("invoice public link demo and payment foundation", () => {
  it("blocks demo create/regenerate/revoke and does not fake online payments", async () => {
    await markDemoUser();
    const customer = await seedCustomer(demoUser.id, { email: "demo-portal@example.test" });
    const product = await seedProduct(demoUser.id, { price: 22 });
    const order = await seedOrder(demoUser.id, customer._id, product._id);
    const now = new Date();
    const invoiceId = new ObjectId();
    await getInvoicesCollection().insertOne({
      _id: invoiceId,
      ownerId: demoUser.id,
      invoiceNumber: "INV-2026-000777",
      orderId: order._id,
      customerId: customer._id,
      customerSnapshot: { name: "Demo Customer", email: "demo-portal@example.test" },
      items: [{ productId: product._id, productName: product.name, quantity: 1, unitPrice: 22, lineTotal: 22 }],
      subtotal: 22,
      discount: 0,
      tax: 0,
      total: 22,
      paidAmount: 0,
      outstandingAmount: 22,
      issueDate: now,
      status: "issued",
      createdAt: now,
      updatedAt: now,
    });

    mockSession(demoUser);
    const createResponse = await createPublicLink(
      jsonRequest("POST", `http://localhost/api/invoices/${invoiceId.toHexString()}/public-link`),
      params(invoiceId.toHexString()),
    );
    expect(createResponse.status).toBe(403);

    const revokeResponse = await revokePublicLinkApi(
      jsonRequest("DELETE", `http://localhost/api/invoices/${invoiceId.toHexString()}/public-link`),
      params(invoiceId.toHexString()),
    );
    expect(revokeResponse.status).toBe(403);

    const getResponse = await getPublicLink(
      jsonRequest("GET", `http://localhost/api/invoices/${invoiceId.toHexString()}/public-link`),
      params(invoiceId.toHexString()),
    );
    expect(getResponse.status).toBe(200);

    const provider = getInvoicePaymentProvider();
    expect(provider.isConfigured()).toBe(false);
    await expect(
      provider.createCheckoutSession({
        ownerId: userA.id,
        invoiceId: invoiceId.toHexString(),
        accessToken: "unused",
        successUrl: "https://example.test/ok",
        cancelUrl: "https://example.test/cancel",
      }),
    ).rejects.toThrow(/not configured/i);
  });
});
