import type Stripe from "stripe";
import { ObjectId } from "mongodb";
import { getInvoicesCollection } from "@/server/db/models/invoice";
import { getPaymentsCollection } from "@/server/db/models/payment";
import {
  ensureStripeEventIndexes,
  getStripeEventsCollection,
  type StripeEventDocument,
} from "@/server/db/models/stripe-event";
import { APP_CURRENCY, stripeCentsToDollars } from "@/server/payments/money";
import { PaymentRecordingError, recordInvoicePayment } from "@/server/payments/record-payment";
import { getStripeClient } from "@/server/payments/providers/stripe-client";
import { requireStripeWebhookSecret, StripeConfigurationError } from "@/server/payments/providers/stripe-config";
import { STRIPE_PAYMENT_CONTEXT } from "@/server/payments/providers/stripe-provider";

export type StripeWebhookResult = {
  httpStatus: number;
  body: { received: boolean; ignored?: boolean; duplicate?: boolean; error?: string };
};

function sanitizeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const message = error.message.trim().slice(0, 240);
    if (!message) return "Processing failed";
    if (/secret|api[_ ]?key|signature|authorization/i.test(message)) return "Processing failed";
    return message;
  }
  return "Processing failed";
}

function isDuplicateKeyError(error: unknown) {
  return Boolean(
    error && typeof error === "object" && "code" in error && (error as { code?: number }).code === 11000,
  );
}

/** Events stuck in `processing` longer than this are assumed crashed and may be reclaimed. */
const PROCESSING_LEASE_MS = 2 * 60 * 1000;

async function claimStripeEvent(
  event: Stripe.Event,
): Promise<{ proceed: boolean; duplicate?: boolean; retryLater?: boolean }> {
  await ensureStripeEventIndexes();
  const now = new Date();

  try {
    await getStripeEventsCollection().insertOne({
      eventId: event.id,
      type: event.type,
      status: "processing",
      createdAt: now,
      updatedAt: now,
    });
    return { proceed: true };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }

  const existing = await getStripeEventsCollection().findOne({ eventId: event.id });
  if (!existing) throw new Error("Unable to load claimed Stripe event");

  if (existing.status === "processed" || existing.status === "ignored") {
    return { proceed: false, duplicate: true };
  }

  if (existing.status === "processing") {
    const ageMs = now.getTime() - existing.updatedAt.getTime();
    if (ageMs < PROCESSING_LEASE_MS) {
      // Still in-flight — ask Stripe to retry shortly rather than double-process.
      return { proceed: false, retryLater: true };
    }

    // Lease expired (likely crash) — reclaim so Stripe retries can complete payment recording.
    const reclaimedStale = await getStripeEventsCollection().findOneAndUpdate(
      {
        eventId: event.id,
        status: "processing",
        updatedAt: { $lte: new Date(now.getTime() - PROCESSING_LEASE_MS) },
      },
      { $set: { status: "processing", updatedAt: now }, $unset: { errorMessage: "" } },
      { returnDocument: "after" },
    );
    if (reclaimedStale) return { proceed: true };
    return { proceed: false, retryLater: true };
  }

  // Previous attempt failed — reclaim for retry.
  const reclaimed = await getStripeEventsCollection().findOneAndUpdate(
    { eventId: event.id, status: "failed" },
    { $set: { status: "processing", updatedAt: now }, $unset: { errorMessage: "" } },
    { returnDocument: "after" },
  );
  if (!reclaimed) return { proceed: false, duplicate: true };
  return { proceed: true };
}

async function markEvent(
  eventId: string,
  status: StripeEventDocument["status"],
  extras: Partial<Pick<StripeEventDocument, "paymentId" | "errorMessage">> = {},
) {
  const now = new Date();
  const update: {
    $set: Record<string, unknown>;
    $unset?: Record<string, "">;
  } = {
    $set: {
      status,
      updatedAt: now,
      ...(status === "processed" || status === "ignored" ? { processedAt: now } : {}),
      ...extras,
    },
  };
  if (status !== "failed") {
    update.$unset = { errorMessage: "" };
  }
  await getStripeEventsCollection().updateOne({ eventId }, update);
}

function extractPaymentIntentId(session: Stripe.Checkout.Session): string | null {
  const paymentIntent = session.payment_intent;
  if (typeof paymentIntent === "string" && paymentIntent.startsWith("pi_")) return paymentIntent;
  if (paymentIntent && typeof paymentIntent === "object" && "id" in paymentIntent) {
    const id = (paymentIntent as { id?: string }).id;
    if (typeof id === "string" && id.startsWith("pi_")) return id;
  }
  return null;
}

async function processCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  if (session.mode !== "payment") {
    return { ignored: true as const };
  }

  if (session.payment_status !== "paid") {
    return { ignored: true as const };
  }

  const ownerId = session.metadata?.ownerId?.trim();
  const invoiceId = session.metadata?.invoiceId?.trim();
  const paymentContext = session.metadata?.paymentContext?.trim();

  if (!ownerId || !invoiceId || !ObjectId.isValid(invoiceId)) {
    throw new PaymentRecordingError("Stripe session metadata is incomplete", 400);
  }
  if (paymentContext !== STRIPE_PAYMENT_CONTEXT) {
    return { ignored: true as const };
  }

  if ((session.currency || "").toLowerCase() !== APP_CURRENCY) {
    throw new PaymentRecordingError("Stripe currency mismatch", 409);
  }

  if (typeof session.amount_total !== "number" || session.amount_total <= 0) {
    throw new PaymentRecordingError("Stripe amount is invalid", 409);
  }

  const paymentIntentId = extractPaymentIntentId(session);
  if (!paymentIntentId) {
    throw new PaymentRecordingError("Stripe PaymentIntent is missing", 409);
  }

  const existingPayment = await getPaymentsCollection().findOne({
    provider: "stripe",
    providerPaymentId: paymentIntentId,
    voidedAt: { $exists: false },
  });
  if (existingPayment) {
    return {
      ignored: false as const,
      paymentId: existingPayment._id?.toHexString(),
      duplicate: true as const,
    };
  }

  const amount = stripeCentsToDollars(session.amount_total);
  const invoice = await getInvoicesCollection().findOne({
    _id: new ObjectId(invoiceId),
    ownerId,
  });
  if (!invoice) throw new PaymentRecordingError("Invoice not found", 404);
  if (invoice.status === "cancelled") {
    throw new PaymentRecordingError("Cannot pay a cancelled invoice", 409);
  }
  if (invoice.outstandingAmount <= 0 || invoice.status === "paid") {
    throw new PaymentRecordingError("Invoice is already fully paid", 409);
  }
  // Apply when Stripe amount is at or below current outstanding (exact pay or underpay after totals change).
  // Reject overpayment relative to current outstanding (stale full-balance session after a partial pay).
  if (amount > invoice.outstandingAmount) {
    throw new PaymentRecordingError("Stripe payment amount exceeds invoice outstanding balance", 409);
  }

  const recorded = await recordInvoicePayment({
    ownerId,
    invoiceId,
    amount,
    paymentMethod: "stripe",
    reference: paymentIntentId,
    notes: "Stripe Checkout payment",
    provider: "stripe",
    providerPaymentId: paymentIntentId,
  });

  if (!recorded.duplicate) {
    await getInvoicesCollection().updateOne(
      { _id: new ObjectId(invoiceId), ownerId },
      { $unset: { pendingStripeCheckout: "" }, $set: { updatedAt: new Date() } },
    );
  }

  return {
    ignored: false as const,
    paymentId: recorded.payment.id,
    duplicate: recorded.duplicate,
  };
}

export function constructStripeEvent(rawBody: string, signature: string | null) {
  if (!signature) {
    throw new StripeConfigurationError("Missing Stripe signature");
  }
  const stripe = getStripeClient();
  return stripe.webhooks.constructEvent(rawBody, signature, requireStripeWebhookSecret());
}

export async function handleStripeWebhookEvent(event: Stripe.Event): Promise<StripeWebhookResult> {
  const claim = await claimStripeEvent(event);
  if (!claim.proceed) {
    if (claim.retryLater) {
      // Ask Stripe to retry while another worker may still be processing (or lease just expired).
      return { httpStatus: 500, body: { received: false, error: "Event processing in progress" } };
    }
    return { httpStatus: 200, body: { received: true, duplicate: true } };
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const result = await processCheckoutSessionCompleted(session);
      if (result.ignored) {
        await markEvent(event.id, "ignored");
        return { httpStatus: 200, body: { received: true, ignored: true } };
      }
      await markEvent(event.id, "processed", { paymentId: result.paymentId });
      return { httpStatus: 200, body: { received: true, duplicate: result.duplicate } };
    }

    // Card-only Checkout — async payment events are acknowledged but not applied.
    if (
      event.type === "checkout.session.async_payment_succeeded" ||
      event.type === "checkout.session.async_payment_failed"
    ) {
      await markEvent(event.id, "ignored");
      return { httpStatus: 200, body: { received: true, ignored: true } };
    }

    await markEvent(event.id, "ignored");
    return { httpStatus: 200, body: { received: true, ignored: true } };
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    await markEvent(event.id, "failed", { errorMessage: message });

    if (error instanceof PaymentRecordingError && (error.status === 409 || error.status === 400)) {
      // Permanent business conflict for this event payload — do not ask Stripe to retry forever.
      console.error("Stripe webhook business rejection", event.id, event.type);
      return { httpStatus: 200, body: { received: true, error: message } };
    }

    console.error("Stripe webhook processing failed", event.id, event.type);
    return { httpStatus: 500, body: { received: false, error: "Unable to process webhook" } };
  }
}
