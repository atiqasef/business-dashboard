import { ObjectId, type Collection } from "mongodb";
import { db } from "@/lib/db";

export const paymentMethods = ["cash", "bank_transfer", "card", "mobile_banking", "stripe", "other"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

export const paymentProviders = ["stripe"] as const;
export type PaymentProvider = (typeof paymentProviders)[number];

export interface PaymentDocument {
  _id?: ObjectId;
  ownerId: string;
  invoiceId: ObjectId;
  orderId: ObjectId;
  customerId: ObjectId;
  amount: number;
  paymentMethod: PaymentMethod;
  reference?: string;
  paymentDate: Date;
  notes?: string;
  /** Online payment provider — absent for manual payments. */
  provider?: PaymentProvider;
  /** Stable provider transaction id (e.g. Stripe PaymentIntent id). */
  providerPaymentId?: string;
  voidedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

let indexesPromise: Promise<void> | null = null;

export function getPaymentsCollection(): Collection<PaymentDocument> {
  return db.collection<PaymentDocument>("payments");
}

export async function ensurePaymentIndexes() {
  if (!indexesPromise) {
    indexesPromise = getPaymentsCollection()
      .createIndexes([
        { key: { ownerId: 1, invoiceId: 1, createdAt: -1 }, name: "owner_invoice_createdAt" },
        { key: { ownerId: 1, customerId: 1 }, name: "owner_customerId" },
        { key: { ownerId: 1, paymentDate: -1 }, name: "owner_paymentDate" },
        { key: { ownerId: 1, createdAt: -1 }, name: "owner_createdAt" },
        { key: { ownerId: 1, paymentMethod: 1, paymentDate: -1 }, name: "owner_method_paymentDate" },
        {
          key: { provider: 1, providerPaymentId: 1 },
          name: "provider_providerPaymentId_unique",
          unique: true,
          partialFilterExpression: {
            provider: { $type: "string" },
            providerPaymentId: { $type: "string" },
          },
        },
      ])
      .then(() => undefined);
  }

  return indexesPromise;
}

export function toPaymentResponse(payment: PaymentDocument) {
  return {
    id: payment._id?.toString(),
    invoiceId: payment.invoiceId.toString(),
    orderId: payment.orderId.toString(),
    customerId: payment.customerId.toString(),
    amount: payment.amount,
    paymentMethod: payment.paymentMethod,
    reference: payment.reference ?? null,
    paymentDate: payment.paymentDate.toISOString(),
    notes: payment.notes ?? null,
    provider: payment.provider ?? null,
    providerPaymentId: payment.providerPaymentId ?? null,
    voidedAt: payment.voidedAt ? payment.voidedAt.toISOString() : null,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}
