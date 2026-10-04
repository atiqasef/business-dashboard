import { createHash, createHmac, randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { buildPublicInvoiceUrl } from "@/server/config/app-url";
import { getCustomersCollection } from "@/server/db/models/customer";
import {
  ensureInvoiceAccessIndexes,
  getInvoiceAccessCollection,
  toPublicLinkState,
  type InvoiceAccessDocument,
  type PublicLinkState,
} from "@/server/db/models/invoice-access";
import { ensureInvoiceIndexes, getInvoicesCollection, type InvoiceDocument } from "@/server/db/models/invoice";
import { deriveInvoiceStatus } from "@/server/invoices/status";
import { getInvoiceBusinessBranding, type InvoiceBusinessBranding } from "@/server/settings/business-profile";

/** Default public invoice link lifetime. */
export const INVOICE_ACCESS_TTL_DAYS = 30;

export class InvoiceAccessError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "InvoiceAccessError";
    this.status = status;
  }
}

function getAccessSecret() {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret) {
    throw new InvoiceAccessError("Server authentication secret is not configured", 503);
  }
  return secret;
}

export function hashInvoiceAccessToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function deriveBearerToken(accessId: ObjectId, nonce: string) {
  return createHmac("sha256", getAccessSecret())
    .update(`invoice-access:${accessId.toHexString()}:${nonce}`)
    .digest("base64url");
}

/** Exposed for tests — verifies token length / URL-safety without logging values. */
export function generateInvoiceAccessNonce() {
  return randomBytes(32).toString("base64url");
}

function isActiveAccess(access: InvoiceAccessDocument, now = new Date()) {
  if (access.revokedAt) return false;
  if (access.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

async function findLatestAccess(ownerId: string, invoiceId: ObjectId) {
  return getInvoiceAccessCollection().findOne({ ownerId, invoiceId }, { sort: { createdAt: -1 } });
}

async function findActiveAccess(ownerId: string, invoiceId: ObjectId, now = new Date()) {
  return getInvoiceAccessCollection().findOne({
    ownerId,
    invoiceId,
    revokedAt: { $exists: false },
    expiresAt: { $gt: now },
  });
}

async function revokeActiveAccess(ownerId: string, invoiceId: ObjectId, now: Date) {
  await getInvoiceAccessCollection().updateMany(
    {
      ownerId,
      invoiceId,
      revokedAt: { $exists: false },
    },
    { $set: { revokedAt: now, updatedAt: now } },
  );
}

function assertValidInvoiceId(invoiceId: string) {
  if (!ObjectId.isValid(invoiceId)) throw new InvoiceAccessError("Invalid invoice id", 400);
  return new ObjectId(invoiceId);
}

async function loadOwnedInvoice(ownerId: string, invoiceId: ObjectId) {
  const invoice = await getInvoicesCollection().findOne({ _id: invoiceId, ownerId });
  if (!invoice) throw new InvoiceAccessError("Invoice not found", 404);
  return invoice;
}

export async function getPublicLinkState(ownerId: string, invoiceId: string): Promise<PublicLinkState> {
  if (!ownerId) throw new InvoiceAccessError("Authentication required", 401);
  const id = assertValidInvoiceId(invoiceId);
  await Promise.all([ensureInvoiceIndexes(), ensureInvoiceAccessIndexes()]);
  await loadOwnedInvoice(ownerId, id);

  const latest = await findLatestAccess(ownerId, id);
  if (!latest) return toPublicLinkState(null);

  const active = isActiveAccess(latest) ? latest : null;
  if (active) {
    const token = deriveBearerToken(active._id!, active.nonce);
    return toPublicLinkState(active, { url: buildPublicInvoiceUrl(token) });
  }

  return toPublicLinkState(latest);
}

export async function createOrRegeneratePublicLink(
  ownerId: string,
  invoiceId: string,
): Promise<PublicLinkState & { url: string; token: string }> {
  if (!ownerId) throw new InvoiceAccessError("Authentication required", 401);
  const id = assertValidInvoiceId(invoiceId);
  await Promise.all([ensureInvoiceIndexes(), ensureInvoiceAccessIndexes()]);
  await loadOwnedInvoice(ownerId, id);

  const now = new Date();
  await revokeActiveAccess(ownerId, id, now);

  const accessId = new ObjectId();
  const nonce = generateInvoiceAccessNonce();
  const token = deriveBearerToken(accessId, nonce);
  const tokenHash = hashInvoiceAccessToken(token);
  const expiresAt = new Date(now.getTime() + INVOICE_ACCESS_TTL_DAYS * 24 * 60 * 60 * 1000);

  const document: InvoiceAccessDocument = {
    _id: accessId,
    ownerId,
    invoiceId: id,
    nonce,
    tokenHash,
    createdAt: now,
    updatedAt: now,
    expiresAt,
  };

  await getInvoiceAccessCollection().insertOne(document);

  return {
    ...toPublicLinkState(document, { url: buildPublicInvoiceUrl(token), now }),
    url: buildPublicInvoiceUrl(token),
    token,
  };
}

/**
 * Returns an active public invoice URL, creating one if needed.
 * Does not revoke/regenerate an already-active link (email-safe reuse).
 */
export async function ensurePublicInvoiceUrl(ownerId: string, invoiceId: ObjectId | string): Promise<string> {
  const id = typeof invoiceId === "string" ? assertValidInvoiceId(invoiceId) : invoiceId;
  await ensureInvoiceAccessIndexes();

  const active = await findActiveAccess(ownerId, id);
  if (active?._id) {
    return buildPublicInvoiceUrl(deriveBearerToken(active._id, active.nonce));
  }

  const created = await createOrRegeneratePublicLink(ownerId, id.toHexString());
  return created.url;
}

export async function revokePublicLink(ownerId: string, invoiceId: string): Promise<PublicLinkState> {
  if (!ownerId) throw new InvoiceAccessError("Authentication required", 401);
  const id = assertValidInvoiceId(invoiceId);
  await Promise.all([ensureInvoiceIndexes(), ensureInvoiceAccessIndexes()]);
  await loadOwnedInvoice(ownerId, id);

  const now = new Date();
  const active = await findActiveAccess(ownerId, id, now);
  if (!active) {
    const latest = await findLatestAccess(ownerId, id);
    return toPublicLinkState(latest, { now });
  }

  await getInvoiceAccessCollection().updateOne(
    { _id: active._id },
    { $set: { revokedAt: now, updatedAt: now } },
  );

  return toPublicLinkState({ ...active, revokedAt: now, updatedAt: now }, { now });
}

export type PublicInvoiceDto = {
  invoiceNumber: string;
  status: string;
  issueDate: string;
  dueDate: string | null;
  customer: {
    name: string;
    email: string | null;
    phone: string | null;
    company: string | null;
    address: string | null;
    city: string | null;
    country: string | null;
  };
  items: Array<{
    productName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paidAmount: number;
  outstandingAmount: number;
  notes: string | null;
  business: InvoiceBusinessBranding;
  payment: {
    onlinePaymentsAvailable: false;
    message: string;
  };
  pdfUrl: string;
};

export type ResolvedPublicInvoice =
  | { ok: true; invoice: InvoiceDocument; access: InvoiceAccessDocument; dto: PublicInvoiceDto }
  | { ok: false; reason: "invalid" | "expired" | "revoked" };

function toPublicInvoiceDto(
  invoice: InvoiceDocument,
  branding: InvoiceBusinessBranding,
  customer: {
    name: string;
    email: string | null;
    phone: string | null;
    company: string | null;
    address: string | null;
    city: string | null;
    country: string | null;
  },
  pdfUrl: string,
): PublicInvoiceDto {
  const status = deriveInvoiceStatus(invoice);
  return {
    invoiceNumber: invoice.invoiceNumber,
    status,
    issueDate: invoice.issueDate.toISOString(),
    dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
    customer: {
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      company: customer.company,
      address: customer.address,
      city: customer.city,
      country: customer.country,
    },
    items: invoice.items.map((item) => ({
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
    subtotal: invoice.subtotal,
    discount: invoice.discount,
    tax: invoice.tax,
    total: invoice.total,
    paidAmount: invoice.paidAmount,
    outstandingAmount: invoice.outstandingAmount,
    notes: invoice.notes ?? null,
    business: branding,
    payment: {
      onlinePaymentsAvailable: false,
      message: "Online payment coming soon",
    },
    pdfUrl,
  };
}

export async function resolvePublicInvoiceByToken(token: string): Promise<ResolvedPublicInvoice> {
  if (typeof token !== "string" || token.length < 16 || token.length > 200) {
    return { ok: false, reason: "invalid" };
  }
  // Reject obviously non-URL-safe / malformed tokens early.
  if (!/^[A-Za-z0-9_-]+$/.test(token)) {
    return { ok: false, reason: "invalid" };
  }

  await Promise.all([ensureInvoiceIndexes(), ensureInvoiceAccessIndexes()]);

  const tokenHash = hashInvoiceAccessToken(token);
  const access = await getInvoiceAccessCollection().findOne({ tokenHash });
  if (!access) return { ok: false, reason: "invalid" };

  const now = new Date();
  if (access.revokedAt) return { ok: false, reason: "revoked" };
  if (access.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };

  // Defense in depth: re-derive and confirm the token matches this access record.
  if (!access._id || deriveBearerToken(access._id, access.nonce) !== token) {
    return { ok: false, reason: "invalid" };
  }

  const invoice = await getInvoicesCollection().findOne({
    _id: access.invoiceId,
    ownerId: access.ownerId,
  });
  if (!invoice) return { ok: false, reason: "invalid" };

  const customer = await getCustomersCollection().findOne(
    { _id: invoice.customerId, ownerId: access.ownerId },
    {
      projection: {
        firstName: 1,
        lastName: 1,
        email: 1,
        phone: 1,
        company: 1,
        address: 1,
        city: 1,
        country: 1,
      },
    },
  );

  const branding = await getInvoiceBusinessBranding(access.ownerId);
  const customerName =
    (customer ? `${customer.firstName} ${customer.lastName}`.trim() : "") || invoice.customerSnapshot.name;

  // Best-effort access tracking — never fail the page on this write.
  void getInvoiceAccessCollection()
    .updateOne({ _id: access._id }, { $set: { lastAccessedAt: now, updatedAt: now } })
    .catch(() => undefined);

  const pdfUrl = `${buildPublicInvoiceUrl(token)}/pdf`;
  const dto = toPublicInvoiceDto(
    invoice,
    branding,
    {
      name: customerName,
      email: customer?.email ?? invoice.customerSnapshot.email ?? null,
      phone: customer?.phone ?? invoice.customerSnapshot.phone ?? null,
      company: customer?.company ?? null,
      address: customer?.address ?? null,
      city: customer?.city ?? null,
      country: customer?.country ?? null,
    },
    pdfUrl,
  );

  return { ok: true, invoice, access, dto };
}
