import { ObjectId } from "mongodb";
import { ensureInvoiceIndexes, getInvoicesCollection, toInvoiceResponse } from "@/server/db/models/invoice";
import {
  ensurePaymentIndexes,
  getPaymentsCollection,
  paymentMethods,
  toPaymentResponse,
  type PaymentDocument,
  type PaymentMethod,
  type PaymentProvider,
} from "@/server/db/models/payment";
import { deriveInvoiceStatus, normalizeMoney } from "@/server/invoices/status";

export class PaymentRecordingError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PaymentRecordingError";
    this.status = status;
  }
}

export type RecordInvoicePaymentInput = {
  ownerId: string;
  invoiceId: string | ObjectId;
  amount: number;
  paymentMethod: PaymentMethod;
  reference?: string;
  notes?: string;
  paymentDate?: Date;
  provider?: PaymentProvider;
  providerPaymentId?: string;
};

async function syncInvoiceStatus(invoiceId: ObjectId, ownerId: string) {
  const invoice = await getInvoicesCollection().findOne({ _id: invoiceId, ownerId });
  if (!invoice) return null;
  const status = deriveInvoiceStatus(invoice);
  if (status === invoice.status) return invoice;
  return getInvoicesCollection().findOneAndUpdate(
    { _id: invoiceId, ownerId },
    { $set: { status, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
}

function isDuplicateKeyError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: number }).code === 11000,
  );
}

/**
 * Records a payment against an owned invoice using the existing atomic outstanding reservation.
 * Used by authenticated payment APIs and verified Stripe webhooks.
 */
export async function recordInvoicePayment(input: RecordInvoicePaymentInput) {
  if (!input.ownerId) throw new PaymentRecordingError("ownerId is required", 401);
  if (!paymentMethods.includes(input.paymentMethod)) {
    throw new PaymentRecordingError("paymentMethod is invalid", 400);
  }

  const invoiceId =
    typeof input.invoiceId === "string"
      ? (() => {
          if (!ObjectId.isValid(input.invoiceId)) throw new PaymentRecordingError("invoiceId is invalid", 400);
          return new ObjectId(input.invoiceId);
        })()
      : input.invoiceId;

  const amount = normalizeMoney(input.amount);
  if (!Number.isFinite(amount) || amount < 0.01) {
    throw new PaymentRecordingError("amount is invalid", 400);
  }

  if (input.providerPaymentId && !input.provider) {
    throw new PaymentRecordingError("provider is required when providerPaymentId is set", 400);
  }

  await Promise.all([ensureInvoiceIndexes(), ensurePaymentIndexes()]);

  // Provider-level idempotency: same Stripe PaymentIntent must never create two payments.
  if (input.provider && input.providerPaymentId) {
    const existing = await getPaymentsCollection().findOne({
      provider: input.provider,
      providerPaymentId: input.providerPaymentId,
      voidedAt: { $exists: false },
    });
    if (existing) {
      const invoice = await getInvoicesCollection().findOne({ _id: existing.invoiceId, ownerId: input.ownerId });
      return {
        payment: toPaymentResponse(existing),
        invoice: invoice ? toInvoiceResponse(invoice) : null,
        duplicate: true as const,
      };
    }
  }

  const invoice = await getInvoicesCollection().findOne({ _id: invoiceId, ownerId: input.ownerId });
  if (!invoice) throw new PaymentRecordingError("Invoice not found", 404);
  if (invoice.status === "cancelled") throw new PaymentRecordingError("Cannot pay a cancelled invoice", 409);
  if (invoice.status === "draft") throw new PaymentRecordingError("Cannot pay a draft invoice", 409);
  if (invoice.outstandingAmount <= 0 || invoice.status === "paid") {
    throw new PaymentRecordingError("Invoice is already fully paid", 409);
  }
  if (amount > invoice.outstandingAmount) {
    throw new PaymentRecordingError("Payment amount exceeds outstanding balance", 409);
  }

  const now = new Date();
  const reserved = await getInvoicesCollection().findOneAndUpdate(
    {
      _id: invoiceId,
      ownerId: input.ownerId,
      status: { $nin: ["cancelled", "draft", "paid"] },
      outstandingAmount: { $gte: amount },
    },
    {
      $inc: { paidAmount: amount, outstandingAmount: -amount },
      $set: { updatedAt: now },
    },
    { returnDocument: "after" },
  );

  if (!reserved) {
    throw new PaymentRecordingError("Payment could not be applied to the outstanding balance", 409);
  }

  const payment: PaymentDocument = {
    ownerId: input.ownerId,
    invoiceId,
    orderId: reserved.orderId,
    customerId: reserved.customerId,
    amount,
    paymentMethod: input.paymentMethod,
    reference: input.reference,
    paymentDate: input.paymentDate ?? now,
    notes: input.notes,
    provider: input.provider,
    providerPaymentId: input.providerPaymentId,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const inserted = await getPaymentsCollection().insertOne(payment);
    const synced = (await syncInvoiceStatus(invoiceId, input.ownerId)) ?? reserved;
    return {
      payment: toPaymentResponse({ ...payment, _id: inserted.insertedId }),
      invoice: toInvoiceResponse(synced),
      duplicate: false as const,
    };
  } catch (error) {
    await getInvoicesCollection().updateOne(
      { _id: invoiceId, ownerId: input.ownerId },
      {
        $inc: { paidAmount: -amount, outstandingAmount: amount },
        $set: { updatedAt: new Date() },
      },
    );
    await syncInvoiceStatus(invoiceId, input.ownerId);

    if (isDuplicateKeyError(error) && input.provider && input.providerPaymentId) {
      const existing = await getPaymentsCollection().findOne({
        provider: input.provider,
        providerPaymentId: input.providerPaymentId,
      });
      if (existing) {
        const currentInvoice = await getInvoicesCollection().findOne({
          _id: existing.invoiceId,
          ownerId: input.ownerId,
        });
        return {
          payment: toPaymentResponse(existing),
          invoice: currentInvoice ? toInvoiceResponse(currentInvoice) : null,
          duplicate: true as const,
        };
      }
    }

    throw error;
  }
}
