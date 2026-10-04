import { createHash, createHmac, randomBytes } from "node:crypto";
import { ObjectId, type Filter } from "mongodb";
import { buildCustomerPortalUrl } from "@/server/config/app-url";
import { getCustomersCollection } from "@/server/db/models/customer";
import {
  ensureCustomerPortalAccessIndexes,
  getCustomerPortalAccessCollection,
  toPortalLinkState,
  type CustomerPortalAccessDocument,
} from "@/server/db/models/customer-portal-access";
import { isReadOnlyDemoUser } from "@/server/db/models/demo-account";
import {
  ensureInvoiceIndexes,
  getInvoicesCollection,
  type InvoiceDocument,
  type InvoiceStatus,
} from "@/server/db/models/invoice";
import type { PublicLinkState } from "@/server/db/models/invoice-access";
import { deriveInvoiceStatus, normalizeMoney } from "@/server/invoices/status";
import { isStripeConfigured } from "@/server/payments/providers/stripe-config";
import { getInvoiceBusinessBranding, type InvoiceBusinessBranding } from "@/server/settings/business-profile";

/** Matches Phase 12 invoice-access TTL (`INVOICE_ACCESS_TTL_DAYS`) for consistent link lifecycle. */
export const CUSTOMER_PORTAL_ACCESS_TTL_DAYS = 30;

export const PORTAL_PAGE_SIZE_DEFAULT = 20;
export const PORTAL_PAGE_SIZE_MAX = 50;

export const portalStatusFilters = ["all", "unpaid", "paid", "overdue", "cancelled"] as const;
export type PortalStatusFilter = (typeof portalStatusFilters)[number];

export const portalSortOptions = ["newest", "oldest", "due_date"] as const;
export type PortalSortOption = (typeof portalSortOptions)[number];

export class CustomerPortalAccessError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "CustomerPortalAccessError";
    this.status = status;
  }
}

function getAccessSecret() {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret) {
    throw new CustomerPortalAccessError("Server authentication secret is not configured", 503);
  }
  return secret;
}

export function hashCustomerPortalToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function deriveBearerToken(accessId: ObjectId, nonce: string) {
  return createHmac("sha256", getAccessSecret())
    .update(`customer-portal-access:${accessId.toHexString()}:${nonce}`)
    .digest("base64url");
}

export function generateCustomerPortalNonce() {
  return randomBytes(32).toString("base64url");
}

function isActiveAccess(access: CustomerPortalAccessDocument, now = new Date()) {
  if (access.revokedAt) return false;
  if (access.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

function assertValidInvoiceId(invoiceId: string) {
  if (!ObjectId.isValid(invoiceId)) throw new CustomerPortalAccessError("Invalid invoice id", 400);
  return new ObjectId(invoiceId);
}

async function loadOwnedInvoice(ownerId: string, invoiceId: ObjectId) {
  const invoice = await getInvoicesCollection().findOne({ _id: invoiceId, ownerId });
  if (!invoice) throw new CustomerPortalAccessError("Invoice not found", 404);
  return invoice;
}

async function findLatestPortalAccess(ownerId: string, customerId: ObjectId) {
  return getCustomerPortalAccessCollection().findOne({ ownerId, customerId }, { sort: { createdAt: -1 } });
}

async function findActivePortalAccess(ownerId: string, customerId: ObjectId, now = new Date()) {
  return getCustomerPortalAccessCollection().findOne({
    ownerId,
    customerId,
    revokedAt: { $exists: false },
    expiresAt: { $gt: now },
  });
}

async function revokeActivePortalAccess(ownerId: string, customerId: ObjectId, now: Date) {
  await getCustomerPortalAccessCollection().updateMany(
    { ownerId, customerId, revokedAt: { $exists: false } },
    { $set: { revokedAt: now, updatedAt: now } },
  );
}

export async function getPortalLinkStateForInvoice(ownerId: string, invoiceId: string): Promise<PublicLinkState> {
  if (!ownerId) throw new CustomerPortalAccessError("Authentication required", 401);
  const id = assertValidInvoiceId(invoiceId);
  await Promise.all([ensureInvoiceIndexes(), ensureCustomerPortalAccessIndexes()]);
  const invoice = await loadOwnedInvoice(ownerId, id);
  const latest = await findLatestPortalAccess(ownerId, invoice.customerId);
  if (!latest) return toPortalLinkState(null);

  if (isActiveAccess(latest) && latest._id) {
    const token = deriveBearerToken(latest._id, latest.nonce);
    return toPortalLinkState(latest, { url: buildCustomerPortalUrl(token) });
  }

  return toPortalLinkState(latest);
}

export async function createOrRegeneratePortalLink(
  ownerId: string,
  invoiceId: string,
): Promise<PublicLinkState & { url: string; token: string }> {
  if (!ownerId) throw new CustomerPortalAccessError("Authentication required", 401);
  const id = assertValidInvoiceId(invoiceId);
  await Promise.all([ensureInvoiceIndexes(), ensureCustomerPortalAccessIndexes()]);
  const invoice = await loadOwnedInvoice(ownerId, id);

  const customer = await getCustomersCollection().findOne({ _id: invoice.customerId, ownerId });
  if (!customer) throw new CustomerPortalAccessError("Customer not found", 404);

  const now = new Date();
  await revokeActivePortalAccess(ownerId, invoice.customerId, now);

  const accessId = new ObjectId();
  const nonce = generateCustomerPortalNonce();
  const token = deriveBearerToken(accessId, nonce);
  const tokenHash = hashCustomerPortalToken(token);
  const expiresAt = new Date(now.getTime() + CUSTOMER_PORTAL_ACCESS_TTL_DAYS * 24 * 60 * 60 * 1000);

  const document: CustomerPortalAccessDocument = {
    _id: accessId,
    ownerId,
    customerId: invoice.customerId,
    sourceInvoiceId: id,
    nonce,
    tokenHash,
    createdAt: now,
    updatedAt: now,
    expiresAt,
  };

  await getCustomerPortalAccessCollection().insertOne(document);
  const url = buildCustomerPortalUrl(token);
  return { ...toPortalLinkState(document, { url, now }), url, token };
}

export async function revokePortalLinkForInvoice(ownerId: string, invoiceId: string): Promise<PublicLinkState> {
  if (!ownerId) throw new CustomerPortalAccessError("Authentication required", 401);
  const id = assertValidInvoiceId(invoiceId);
  await Promise.all([ensureInvoiceIndexes(), ensureCustomerPortalAccessIndexes()]);
  const invoice = await loadOwnedInvoice(ownerId, id);

  const now = new Date();
  const active = await findActivePortalAccess(ownerId, invoice.customerId, now);
  if (!active) {
    const latest = await findLatestPortalAccess(ownerId, invoice.customerId);
    return toPortalLinkState(latest, { now });
  }

  await getCustomerPortalAccessCollection().updateOne(
    { _id: active._id },
    { $set: { revokedAt: now, updatedAt: now } },
  );

  return toPortalLinkState({ ...active, revokedAt: now, updatedAt: now }, { now });
}

export type ResolvedCustomerPortal =
  | {
      ok: true;
      access: CustomerPortalAccessDocument;
      customer: {
        name: string;
        email: string | null;
        phone: string | null;
        company: string | null;
        address: string | null;
        city: string | null;
        country: string | null;
      };
      business: InvoiceBusinessBranding;
      isDemoOwner: boolean;
    }
  | { ok: false; reason: "invalid" | "expired" | "revoked" };

export async function resolveCustomerPortalByToken(token: string): Promise<ResolvedCustomerPortal> {
  if (typeof token !== "string" || token.length < 16 || token.length > 200) {
    return { ok: false, reason: "invalid" };
  }
  if (!/^[A-Za-z0-9_-]+$/.test(token)) {
    return { ok: false, reason: "invalid" };
  }

  await Promise.all([ensureInvoiceIndexes(), ensureCustomerPortalAccessIndexes()]);

  const tokenHash = hashCustomerPortalToken(token);
  const access = await getCustomerPortalAccessCollection().findOne({ tokenHash });
  if (!access) return { ok: false, reason: "invalid" };

  const now = new Date();
  if (access.revokedAt) return { ok: false, reason: "revoked" };
  if (access.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (!access._id || deriveBearerToken(access._id, access.nonce) !== token) {
    return { ok: false, reason: "invalid" };
  }

  const customer = await getCustomersCollection().findOne(
    { _id: access.customerId, ownerId: access.ownerId },
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
  if (!customer) return { ok: false, reason: "invalid" };

  const branding = await getInvoiceBusinessBranding(access.ownerId);
  const isDemoOwner = await isReadOnlyDemoUser(access.ownerId);

  void getCustomerPortalAccessCollection()
    .updateOne({ _id: access._id }, { $set: { lastAccessedAt: now, updatedAt: now } })
    .catch(() => undefined);

  return {
    ok: true,
    access,
    customer: {
      name: `${customer.firstName} ${customer.lastName}`.trim() || "Customer",
      email: customer.email ?? null,
      phone: customer.phone ?? null,
      company: customer.company ?? null,
      address: customer.address ?? null,
      city: customer.city ?? null,
      country: customer.country ?? null,
    },
    business: branding,
    isDemoOwner,
  };
}

export type PortalInvoiceListItem = {
  invoiceNumber: string;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string | null;
  total: number;
  paidAmount: number;
  outstandingAmount: number;
  canPay: boolean;
};

export type PortalSummary = {
  customerName: string;
  invoiceCount: number;
  outstandingTotal: number;
  overdueCount: number;
  businessName: string;
  logoUrl: string | null;
};

function paymentCanPay(invoice: InvoiceDocument, isDemoOwner: boolean) {
  if (isDemoOwner || !isStripeConfigured()) return false;
  const status = deriveInvoiceStatus(invoice);
  return status !== "cancelled" && status !== "draft" && status !== "paid" && invoice.outstandingAmount > 0;
}

function toListItem(invoice: InvoiceDocument, isDemoOwner: boolean): PortalInvoiceListItem {
  const status = deriveInvoiceStatus(invoice);
  return {
    invoiceNumber: invoice.invoiceNumber,
    status,
    issueDate: invoice.issueDate.toISOString(),
    dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
    total: invoice.total,
    paidAmount: invoice.paidAmount,
    outstandingAmount: invoice.outstandingAmount,
    canPay: paymentCanPay(invoice, isDemoOwner),
  };
}

function parsePage(value: unknown) {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : 1;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function parsePageSize(value: unknown) {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : PORTAL_PAGE_SIZE_DEFAULT;
  if (!Number.isFinite(n) || n < 1) return PORTAL_PAGE_SIZE_DEFAULT;
  return Math.min(Math.floor(n), PORTAL_PAGE_SIZE_MAX);
}

function parseStatusFilter(value: unknown): PortalStatusFilter {
  if (typeof value !== "string" || !portalStatusFilters.includes(value as PortalStatusFilter)) {
    if (value === undefined || value === null || value === "") return "all";
    throw new CustomerPortalAccessError("status filter is invalid", 400);
  }
  return value as PortalStatusFilter;
}

function parseSort(value: unknown): PortalSortOption {
  if (typeof value !== "string" || !portalSortOptions.includes(value as PortalSortOption)) {
    if (value === undefined || value === null || value === "") return "newest";
    throw new CustomerPortalAccessError("sort is invalid", 400);
  }
  return value as PortalSortOption;
}

function parseSearch(value: unknown) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new CustomerPortalAccessError("search is invalid", 400);
  const trimmed = value.trim();
  if (trimmed.length > 80) throw new CustomerPortalAccessError("search is too long", 400);
  // Reject Mongo operator injection attempts.
  if (trimmed.startsWith("$") || /[{}]/.test(trimmed)) {
    throw new CustomerPortalAccessError("search is invalid", 400);
  }
  return trimmed;
}

function buildInvoiceMatch(
  ownerId: string,
  customerId: ObjectId,
  status: PortalStatusFilter,
  search: string,
  now: Date,
): Filter<InvoiceDocument> {
  const match: Filter<InvoiceDocument> = { ownerId, customerId };

  if (search) {
    match.invoiceNumber = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  }

  switch (status) {
    case "paid":
      match.status = "paid";
      break;
    case "cancelled":
      match.status = "cancelled";
      break;
    case "overdue":
      match.status = { $nin: ["cancelled", "draft", "paid"] };
      match.outstandingAmount = { $gt: 0 };
      match.dueDate = { $exists: true, $type: "date", $lt: now };
      break;
    case "unpaid":
      match.status = { $nin: ["cancelled", "draft", "paid"] };
      match.outstandingAmount = { $gt: 0 };
      break;
    default:
      break;
  }

  return match;
}

function buildSort(sort: PortalSortOption): Record<string, 1 | -1> {
  switch (sort) {
    case "oldest":
      return { createdAt: 1, _id: 1 };
    case "due_date":
      return { dueDate: 1, createdAt: -1 };
    default:
      return { createdAt: -1, _id: -1 };
  }
}

export async function listPortalInvoices(
  token: string,
  options: {
    page?: unknown;
    pageSize?: unknown;
    status?: unknown;
    search?: unknown;
    sort?: unknown;
  } = {},
) {
  const resolved = await resolveCustomerPortalByToken(token);
  if (!resolved.ok) {
    throw new CustomerPortalAccessError("This portal link is invalid or has expired.", 404);
  }

  const page = parsePage(options.page);
  const pageSize = parsePageSize(options.pageSize);
  const status = parseStatusFilter(options.status);
  const search = parseSearch(options.search);
  const sort = parseSort(options.sort);
  const now = new Date();

  const match = buildInvoiceMatch(resolved.access.ownerId, resolved.access.customerId, status, search, now);
  const collection = getInvoicesCollection();

  const [total, invoices, summaryAgg] = await Promise.all([
    collection.countDocuments(match),
    collection
      .find(match)
      .sort(buildSort(sort))
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
    collection
      .aggregate<{
        invoiceCount: number;
        outstandingTotal: number;
        overdueCount: number;
      }>([
        {
          $match: {
            ownerId: resolved.access.ownerId,
            customerId: resolved.access.customerId,
          },
        },
        {
          $group: {
            _id: null,
            invoiceCount: { $sum: 1 },
            outstandingTotal: {
              $sum: {
                $cond: [{ $ne: ["$status", "cancelled"] }, "$outstandingAmount", 0],
              },
            },
            overdueCount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ["$status", "cancelled"] },
                      { $ne: ["$status", "draft"] },
                      { $ne: ["$status", "paid"] },
                      { $gt: ["$outstandingAmount", 0] },
                      { $lt: ["$dueDate", now] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ])
      .toArray(),
  ]);

  const summaryRow = summaryAgg[0];
  const summary: PortalSummary = {
    customerName: resolved.customer.name,
    invoiceCount: summaryRow?.invoiceCount ?? 0,
    outstandingTotal: normalizeMoney(summaryRow?.outstandingTotal ?? 0),
    overdueCount: summaryRow?.overdueCount ?? 0,
    businessName: resolved.business.businessName,
    logoUrl: resolved.business.logoUrl,
  };

  return {
    summary,
    data: invoices.map((invoice) => toListItem(invoice, resolved.isDemoOwner)),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 0,
    },
    filters: { status, search, sort },
  };
}

export async function getPortalInvoiceByNumber(token: string, invoiceNumber: string) {
  const resolved = await resolveCustomerPortalByToken(token);
  if (!resolved.ok) {
    throw new CustomerPortalAccessError("This portal link is invalid or has expired.", 404);
  }

  if (typeof invoiceNumber !== "string" || !invoiceNumber.trim() || invoiceNumber.length > 80) {
    throw new CustomerPortalAccessError("Invoice not found", 404);
  }

  const invoice = await getInvoicesCollection().findOne({
    ownerId: resolved.access.ownerId,
    customerId: resolved.access.customerId,
    invoiceNumber: invoiceNumber.trim(),
  });
  if (!invoice) {
    // Generic not-found — do not reveal whether the invoice exists for another customer.
    throw new CustomerPortalAccessError("Invoice not found", 404);
  }

  return { resolved, invoice };
}

export type PortalInvoiceDetailDto = {
  invoiceNumber: string;
  status: InvoiceStatus;
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
    onlinePaymentsAvailable: boolean;
    canPay: boolean;
    message: string;
  };
  pdfUrl: string;
  checkoutPath: string;
  portalHomePath: string;
};

export async function getPortalInvoiceDetailDto(token: string, invoiceNumber: string): Promise<PortalInvoiceDetailDto> {
  const { resolved, invoice } = await getPortalInvoiceByNumber(token, invoiceNumber);
  const status = deriveInvoiceStatus(invoice);
  const canPay = paymentCanPay(invoice, resolved.isDemoOwner);

  let message = "Pay securely with Stripe Checkout";
  let onlinePaymentsAvailable = isStripeConfigured() && !resolved.isDemoOwner;
  if (resolved.isDemoOwner) {
    message = "Online payment unavailable in demo";
    onlinePaymentsAvailable = false;
  } else if (!isStripeConfigured()) {
    message = "Online payment is not configured";
  } else if (!canPay) {
    message = status === "paid" ? "This invoice is paid in full" : "Online payment is unavailable for this invoice";
  }

  const encoded = encodeURIComponent(invoice.invoiceNumber);
  return {
    invoiceNumber: invoice.invoiceNumber,
    status,
    issueDate: invoice.issueDate.toISOString(),
    dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
    customer: resolved.customer,
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
    business: resolved.business,
    payment: { onlinePaymentsAvailable, canPay, message },
    pdfUrl: `/api/public/portal/${token}/invoices/${encoded}/pdf`,
    checkoutPath: `/api/public/portal/${token}/invoices/${encoded}/checkout`,
    portalHomePath: `/portal/${token}`,
  };
}
