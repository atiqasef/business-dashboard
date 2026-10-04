import { ObjectId } from "mongodb";
import { ensureCustomerIndexes, getCustomersCollection } from "@/server/db/models/customer";
import { ensureInvoiceIndexes, getInvoicesCollection } from "@/server/db/models/invoice";
import {
  ensurePaymentIndexes,
  getPaymentsCollection,
  paymentMethods,
  toPaymentResponse,
  type PaymentMethod,
} from "@/server/db/models/payment";
import { normalizeMoney } from "@/server/invoices/status";
import { resolvePaymentDateRange } from "@/server/payments/date-range";

export const paymentStatuses = ["active", "voided"] as const;
export type PaymentStatusFilter = (typeof paymentStatuses)[number];

export type PaymentListItem = ReturnType<typeof toPaymentResponse> & {
  status: PaymentStatusFilter;
  invoiceNumber: string;
  customerName: string;
  customerEmail: string | null;
  invoiceOutstandingAmount: number | null;
};

export type PaymentListResult = {
  data: PaymentListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  summary: {
    totalCollected: number;
    paymentCount: number;
    activePaymentCount: number;
    averagePayment: number;
    /** Current outstanding across non-cancelled invoices (not limited to the selected payment period). */
    outstandingReceivables: number;
  };
  range: {
    preset: string;
    label: string;
    start: string | null;
    end: string | null;
  };
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isObjectIdString(value: string) {
  return /^[a-fA-F0-9]{24}$/.test(value);
}

export type ListPaymentsOptions = {
  page?: number | string | null;
  pageSize?: number | string | null;
  search?: string | null;
  status?: string | null;
  paymentMethod?: string | null;
  datePreset?: string | null;
  start?: string | null;
  end?: string | null;
  invoiceId?: string | null;
  customerId?: string | null;
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export async function listPayments(ownerId: string, options: ListPaymentsOptions = {}): Promise<PaymentListResult> {
  if (!ownerId || typeof ownerId !== "string") throw new Error("ownerId is required");

  const page = Math.max(Number.parseInt(String(options.page ?? "1"), 10) || 1, 1);
  const pageSize = Math.min(
    Math.max(Number.parseInt(String(options.pageSize ?? String(DEFAULT_PAGE_SIZE)), 10) || DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );

  const statusRaw = options.status?.trim() || "all";
  if (statusRaw !== "all" && !paymentStatuses.includes(statusRaw as PaymentStatusFilter)) {
    throw new Error("status is invalid");
  }

  const methodRaw = options.paymentMethod?.trim() || "all";
  if (methodRaw !== "all" && !paymentMethods.includes(methodRaw as PaymentMethod)) {
    throw new Error("paymentMethod is invalid");
  }

  const range = resolvePaymentDateRange({
    preset: options.datePreset,
    start: options.start,
    end: options.end,
  });

  await Promise.all([ensurePaymentIndexes(), ensureInvoiceIndexes(), ensureCustomerIndexes()]);

  const match: Record<string, unknown> = { ownerId };
  if (options.invoiceId) {
    if (!ObjectId.isValid(options.invoiceId)) throw new Error("invoiceId is invalid");
    match.invoiceId = new ObjectId(options.invoiceId);
  }
  if (options.customerId) {
    if (!ObjectId.isValid(options.customerId)) throw new Error("customerId is invalid");
    match.customerId = new ObjectId(options.customerId);
  }
  if (statusRaw === "active") match.voidedAt = { $exists: false };
  if (statusRaw === "voided") match.voidedAt = { $exists: true };
  if (methodRaw !== "all") match.paymentMethod = methodRaw;
  if (range.start && range.end) {
    match.paymentDate = { $gte: range.start, $lte: range.end };
  }

  const search = options.search?.trim();
  const pipeline: Record<string, unknown>[] = [{ $match: match }];

  pipeline.push(
    {
      $lookup: {
        from: "invoices",
        let: { invoiceId: "$invoiceId", owner: "$ownerId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [{ $eq: ["$_id", "$$invoiceId"] }, { $eq: ["$ownerId", "$$owner"] }],
              },
            },
          },
          {
            $project: {
              invoiceNumber: 1,
              outstandingAmount: 1,
              customerSnapshot: 1,
            },
          },
        ],
        as: "invoice",
      },
    },
    { $unwind: { path: "$invoice", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "customers",
        let: { customerId: "$customerId", owner: "$ownerId" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [{ $eq: ["$_id", "$$customerId"] }, { $eq: ["$ownerId", "$$owner"] }],
              },
            },
          },
          { $project: { firstName: 1, lastName: 1, email: 1 } },
        ],
        as: "customer",
      },
    },
    { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
  );

  if (search) {
    const escaped = escapeRegExp(search);
    const or: Record<string, unknown>[] = [
      { reference: { $regex: escaped, $options: "i" } },
      { notes: { $regex: escaped, $options: "i" } },
      { "invoice.invoiceNumber": { $regex: escaped, $options: "i" } },
      { "invoice.customerSnapshot.name": { $regex: escaped, $options: "i" } },
      { "invoice.customerSnapshot.email": { $regex: escaped, $options: "i" } },
      { "customer.firstName": { $regex: escaped, $options: "i" } },
      { "customer.lastName": { $regex: escaped, $options: "i" } },
      { "customer.email": { $regex: escaped, $options: "i" } },
    ];
    if (isObjectIdString(search)) {
      or.push({ _id: new ObjectId(search) });
    }
    pipeline.push({ $match: { $or: or } });
  }

  pipeline.push({
    $facet: {
      items: [
        { $sort: { paymentDate: -1, createdAt: -1, _id: -1 } },
        { $skip: (page - 1) * pageSize },
        { $limit: pageSize },
      ],
      totalCount: [{ $count: "count" }],
      activeTotals: [
        { $match: { voidedAt: { $exists: false } } },
        {
          $group: {
            _id: null,
            totalCollected: { $sum: "$amount" },
            activePaymentCount: { $sum: 1 },
          },
        },
      ],
    },
  });

  const [facet] = await getPaymentsCollection()
    .aggregate<{
      items: Array<Record<string, unknown>>;
      totalCount: Array<{ count: number }>;
      activeTotals: Array<{ totalCollected: number; activePaymentCount: number }>;
    }>(pipeline)
    .toArray();

  const outstandingGroups = await getInvoicesCollection()
    .aggregate<{ _id: null; outstandingReceivables: number }>([
      { $match: { ownerId, status: { $ne: "cancelled" } } },
      { $group: { _id: null, outstandingReceivables: { $sum: "$outstandingAmount" } } },
    ])
    .toArray();

  const total = facet?.totalCount[0]?.count ?? 0;
  const totalCollected = normalizeMoney(facet?.activeTotals[0]?.totalCollected ?? 0);
  const activePaymentCount = facet?.activeTotals[0]?.activePaymentCount ?? 0;

  const data: PaymentListItem[] = (facet?.items ?? []).map((doc) => {
    const payment = toPaymentResponse({
      _id: doc._id as ObjectId,
      ownerId: String(doc.ownerId),
      invoiceId: doc.invoiceId as ObjectId,
      orderId: doc.orderId as ObjectId,
      customerId: doc.customerId as ObjectId,
      amount: Number(doc.amount),
      paymentMethod: doc.paymentMethod as PaymentMethod,
      reference: typeof doc.reference === "string" ? doc.reference : undefined,
      paymentDate: doc.paymentDate as Date,
      notes: typeof doc.notes === "string" ? doc.notes : undefined,
      voidedAt: doc.voidedAt instanceof Date ? doc.voidedAt : undefined,
      createdAt: doc.createdAt as Date,
      updatedAt: doc.updatedAt as Date,
    });

    const invoice = doc.invoice as
      | { invoiceNumber?: string; outstandingAmount?: number; customerSnapshot?: { name?: string; email?: string } }
      | undefined;
    const customer = doc.customer as
      | { firstName?: string; lastName?: string; email?: string }
      | undefined;

    const customerName =
      `${customer?.firstName ?? ""} ${customer?.lastName ?? ""}`.trim() ||
      invoice?.customerSnapshot?.name ||
      "Unknown customer";

    return {
      ...payment,
      status: payment.voidedAt ? "voided" : "active",
      invoiceNumber: invoice?.invoiceNumber ?? "—",
      customerName,
      customerEmail: customer?.email ?? invoice?.customerSnapshot?.email ?? null,
      invoiceOutstandingAmount:
        typeof invoice?.outstandingAmount === "number" ? normalizeMoney(invoice.outstandingAmount) : null,
    };
  });

  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 0,
    },
    summary: {
      totalCollected,
      paymentCount: total,
      activePaymentCount,
      averagePayment: activePaymentCount > 0 ? normalizeMoney(totalCollected / activePaymentCount) : 0,
      outstandingReceivables: normalizeMoney(outstandingGroups[0]?.outstandingReceivables ?? 0),
    },
    range: {
      preset: range.preset,
      label: range.label,
      start: range.start?.toISOString() ?? null,
      end: range.end?.toISOString() ?? null,
    },
  };
}

export async function getPaymentDetail(ownerId: string, paymentId: string) {
  if (!ownerId || typeof ownerId !== "string") throw new Error("ownerId is required");
  if (!ObjectId.isValid(paymentId)) throw new Error("payment id is invalid");

  await Promise.all([ensurePaymentIndexes(), ensureInvoiceIndexes(), ensureCustomerIndexes()]);

  const id = new ObjectId(paymentId);
  const payment = await getPaymentsCollection().findOne({ _id: id, ownerId });
  if (!payment) return null;

  const [invoice, customer] = await Promise.all([
    getInvoicesCollection().findOne(
      { _id: payment.invoiceId, ownerId },
      { projection: { invoiceNumber: 1, outstandingAmount: 1, status: 1, customerSnapshot: 1 } },
    ),
    getCustomersCollection().findOne(
      { _id: payment.customerId, ownerId },
      { projection: { firstName: 1, lastName: 1, email: 1 } },
    ),
  ]);

  const base = toPaymentResponse(payment);
  const customerName =
    (customer ? `${customer.firstName} ${customer.lastName}`.trim() : "") ||
    invoice?.customerSnapshot.name ||
    "Unknown customer";

  return {
    ...base,
    status: (payment.voidedAt ? "voided" : "active") as PaymentStatusFilter,
    invoiceNumber: invoice?.invoiceNumber ?? "—",
    invoiceStatus: invoice?.status ?? null,
    customerName,
    customerEmail: customer?.email ?? invoice?.customerSnapshot.email ?? null,
    invoiceOutstandingAmount: invoice ? normalizeMoney(invoice.outstandingAmount) : null,
  };
}
