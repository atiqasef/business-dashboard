import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { auth } from "@/lib/auth";
import { assertDemoWriteAllowed } from "@/server/auth/demo-access";
import { ensureInvoiceIndexes, getInvoicesCollection, toInvoiceResponse } from "@/server/db/models/invoice";
import {
  ensurePaymentIndexes,
  getPaymentsCollection,
  paymentMethods,
  toPaymentResponse,
  type PaymentMethod,
} from "@/server/db/models/payment";
import { deriveInvoiceStatus, normalizeMoney } from "@/server/invoices/status";
import { getPaymentDetail, listPayments } from "@/server/payments/list-payments";
import { PaymentRecordingError, recordInvoicePayment } from "@/server/payments/record-payment";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function getId(value: unknown, field: string) {
  if (typeof value !== "string" || !ObjectId.isValid(value)) throw new Error(`${field} is invalid`);
  return new ObjectId(value);
}

function parseNumber(value: unknown, field: string, options: { min?: number; allowZero?: boolean } = {}) {
  const { min = Number.NEGATIVE_INFINITY, allowZero = false } = options;
  if (value === undefined || value === null) throw new Error(`${field} is required`);
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) throw new Error(`${field} must be a valid number`);
  if (numeric < min || (!allowZero && numeric === 0)) throw new Error(`${field} is invalid`);
  return numeric;
}

function parseOptionalDate(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return new Date();
  if (typeof value !== "string") throw new Error(`${field} is invalid`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} is invalid`);
  return date;
}

function textValue(value: unknown, field: string, maxLength = 500) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new Error(`${field} is too long`);
  return trimmed || undefined;
}

async function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}

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

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  const url = new URL(request.url);

  try {
    const result = await listPayments(session.user.id, {
      page: url.searchParams.get("page"),
      pageSize: url.searchParams.get("pageSize"),
      search: url.searchParams.get("search"),
      status: url.searchParams.get("status"),
      paymentMethod: url.searchParams.get("paymentMethod"),
      datePreset: url.searchParams.get("datePreset"),
      start: url.searchParams.get("start"),
      end: url.searchParams.get("end"),
      invoiceId: url.searchParams.get("invoiceId"),
      customerId: url.searchParams.get("customerId"),
    });
    return NextResponse.json(result);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("is invalid") ||
        error.message.includes("Invalid date preset") ||
        error.message.includes("Custom range") ||
        error.message.includes("must be YYYY-MM-DD") ||
        error.message.includes("start must be"))
    ) {
      return errorResponse(error.message, 400);
    }
    return errorResponse("Unable to load payments", 500);
  }
}

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);
  const demoWriteResponse = await assertDemoWriteAllowed(session.user.id);
  if (demoWriteResponse) return demoWriteResponse;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const invoiceId = getId(body.invoiceId, "invoiceId").toHexString();
    const amount = normalizeMoney(parseNumber(body.amount, "amount", { min: 0.01 }));
    const paymentMethod = body.paymentMethod;
    if (typeof paymentMethod !== "string" || !paymentMethods.includes(paymentMethod as PaymentMethod)) {
      throw new Error("paymentMethod is invalid");
    }
    // Online Stripe payments are recorded only by verified webhooks.
    if (paymentMethod === "stripe") {
      return errorResponse("Stripe payments must be completed through Checkout", 400);
    }

    const reference = textValue(body.reference, "reference", 200);
    const notes = textValue(body.notes, "notes", 2000);
    const paymentDate = parseOptionalDate(body.paymentDate, "paymentDate");

    const result = await recordInvoicePayment({
      ownerId: session.user.id,
      invoiceId,
      amount,
      paymentMethod: paymentMethod as PaymentMethod,
      reference,
      notes,
      paymentDate,
    });

    return NextResponse.json(
      {
        data: {
          payment: result.payment,
          invoice: result.invoice,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof PaymentRecordingError) {
      return errorResponse(error.message, error.status);
    }
    if (error instanceof Error) {
      if (
        error.message.includes("is invalid") ||
        error.message.includes("is required") ||
        error.message.includes("must be") ||
        error.message.includes("is too long")
      ) {
        return errorResponse(error.message, 400);
      }
    }
    return errorResponse("Unable to create payment", 500);
  }
}

export async function GET_BY_ID(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  try {
    const id = (await context.params).id;
    const payment = await getPaymentDetail(session.user.id, id);
    return payment ? NextResponse.json({ data: payment }) : errorResponse("Payment not found", 404);
  } catch (error) {
    if (error instanceof Error && error.message.includes("is invalid")) return errorResponse("Invalid payment id", 400);
    return errorResponse("Unable to load payment", 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);
  const demoWriteResponse = await assertDemoWriteAllowed(session.user.id);
  if (demoWriteResponse) return demoWriteResponse;

  try {
    await ensureInvoiceIndexes();
    await ensurePaymentIndexes();

    const id = getId((await context.params).id, "payment id");
    const payment = await getPaymentsCollection().findOne({ _id: id, ownerId: session.user.id });
    if (!payment) return errorResponse("Payment not found", 404);
    if (payment.voidedAt) return errorResponse("Payment is already voided", 409);

    const invoice = await getInvoicesCollection().findOne({ _id: payment.invoiceId, ownerId: session.user.id });
    if (!invoice) return errorResponse("Invoice not found", 404);
    if (invoice.status === "cancelled") return errorResponse("Cannot void payments on a cancelled invoice", 409);

    const now = new Date();
    const voided = await getPaymentsCollection().findOneAndUpdate(
      { _id: id, ownerId: session.user.id, voidedAt: { $exists: false } },
      { $set: { voidedAt: now, updatedAt: now } },
      { returnDocument: "after" },
    );
    if (!voided) return errorResponse("Payment is already voided", 409);

    const updatedInvoice = await getInvoicesCollection().findOneAndUpdate(
      {
        _id: payment.invoiceId,
        ownerId: session.user.id,
        paidAmount: { $gte: payment.amount },
      },
      {
        $inc: { paidAmount: -payment.amount, outstandingAmount: payment.amount },
        $set: { updatedAt: now },
      },
      { returnDocument: "after" },
    );

    if (!updatedInvoice) {
      await getPaymentsCollection().updateOne(
        { _id: id, ownerId: session.user.id },
        { $unset: { voidedAt: "" }, $set: { updatedAt: new Date() } },
      );
      return errorResponse("Unable to void payment", 409);
    }

    const synced = (await syncInvoiceStatus(payment.invoiceId, session.user.id)) ?? updatedInvoice;
    return NextResponse.json({
      data: {
        payment: toPaymentResponse(voided),
        invoice: toInvoiceResponse(synced),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("is invalid")) return errorResponse("Invalid payment id", 400);
    return errorResponse("Unable to void payment", 500);
  }
}
