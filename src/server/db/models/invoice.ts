import { ObjectId, type Collection } from "mongodb";
import { db } from "@/lib/db";

export const invoiceStatuses = ["draft", "issued", "partially_paid", "paid", "overdue", "cancelled"] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];

export type InvoiceCustomerSnapshot = {
  name: string;
  email?: string;
  phone?: string;
};

export type InvoiceItem = {
  productId: ObjectId;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

/** Tracks the latest Stripe Checkout Session so prior sessions can be expired before creating another. */
export type PendingStripeCheckout = {
  sessionId: string;
  amountCents: number;
  createdAt: Date;
  expiresAt: Date;
};

export interface InvoiceDocument {
  _id?: ObjectId;
  ownerId: string;
  invoiceNumber: string;
  orderId: ObjectId;
  customerId: ObjectId;
  customerSnapshot: InvoiceCustomerSnapshot;
  items: InvoiceItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paidAmount: number;
  outstandingAmount: number;
  issueDate: Date;
  dueDate?: Date;
  status: InvoiceStatus;
  notes?: string;
  /** Best-effort registry of the active Stripe Checkout Session for this invoice. */
  pendingStripeCheckout?: PendingStripeCheckout;
  createdAt: Date;
  updatedAt: Date;
}

let indexesPromise: Promise<void> | null = null;

export function getInvoicesCollection(): Collection<InvoiceDocument> {
  return db.collection<InvoiceDocument>("invoices");
}

export async function ensureInvoiceIndexes() {
  if (!indexesPromise) {
    indexesPromise = getInvoicesCollection()
      .createIndexes([
        { key: { ownerId: 1, invoiceNumber: 1 }, name: "owner_invoiceNumber_unique", unique: true },
        {
          key: { ownerId: 1, orderId: 1 },
          name: "owner_order_active_unique",
          unique: true,
          // Use $in (not $ne): memory-server and older Mongo partial indexes reject $ne/$not.
          partialFilterExpression: {
            status: {
              $in: ["draft", "issued", "partially_paid", "paid", "overdue"],
            },
          },
        },
        { key: { ownerId: 1, createdAt: -1 }, name: "owner_createdAt" },
        { key: { ownerId: 1, status: 1 }, name: "owner_status" },
        { key: { ownerId: 1, customerId: 1 }, name: "owner_customerId" },
        { key: { ownerId: 1, customerId: 1, createdAt: -1 }, name: "owner_customer_createdAt" },
        { key: { ownerId: 1, dueDate: 1 }, name: "owner_dueDate" },
      ])
      .then(() => undefined);
  }

  return indexesPromise;
}

export function toInvoiceResponse(invoice: InvoiceDocument) {
  return {
    id: invoice._id?.toString(),
    invoiceNumber: invoice.invoiceNumber,
    orderId: invoice.orderId.toString(),
    customerId: invoice.customerId.toString(),
    customerSnapshot: {
      name: invoice.customerSnapshot.name,
      email: invoice.customerSnapshot.email ?? null,
      phone: invoice.customerSnapshot.phone ?? null,
    },
    items: invoice.items.map((item) => ({
      productId: item.productId.toString(),
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
    issueDate: invoice.issueDate.toISOString(),
    dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
    status: invoice.status,
    notes: invoice.notes ?? null,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
  };
}
