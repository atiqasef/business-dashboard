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
  type PaymentDocument,
  type PaymentMethod,
} from "@/server/db/models/payment";
import { deriveInvoiceStatus, normalizeMoney } from "@/server/invoices/status";

const maxPageSize = 100;

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
  const page = Math.max(Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1, 1);
  const pageSize = Math.min(Math.max(Number.parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25, 1), maxPageSize);

  try {
    await ensurePaymentIndexes();
    const filter: Record<string, unknown> = { ownerId: session.user.id };
    const invoiceId = url.searchParams.get("invoiceId");
    const customerId = url.searchParams.get("customerId");
    if (invoiceId) filter.invoiceId = getId(invoiceId, "invoiceId");
    if (customerId) filter.customerId = getId(customerId, "customerId");

    const collection = getPaymentsCollection();
    const [payments, total] = await Promise.all([
      collection.find(filter).sort({ paymentDate: -1, createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
      collection.countDocuments(filter),
    ]);

    return NextResponse.json({
      data: payments.map(toPaymentResponse),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("is invalid")) return errorResponse(error.message, 400);
    return errorResponse("Unable to load payments", 500);
  }
}

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);
  const demoWriteResponse = await assertDemoWriteAllowed(session.user.id);
  if (demoWriteResponse) return demoWriteResponse;

  try {
    await ensureInvoiceIndexes();
    await ensurePaymentIndexes();

    const body = (await request.json()) as Record<string, unknown>;
    const invoiceId = getId(body.invoiceId, "invoiceId");
    const amount = normalizeMoney(parseNumber(body.amount, "amount", { min: 0.01 }));
    const paymentMethod = body.paymentMethod;
    if (typeof paymentMethod !== "string" || !paymentMethods.includes(paymentMethod as PaymentMethod)) {
      throw new Error("paymentMethod is invalid");
    }
    const reference = textValue(body.reference, "reference", 200);
    const notes = textValue(body.notes, "notes", 2000);
    const paymentDate = parseOptionalDate(body.paymentDate, "paymentDate");

    const invoice = await getInvoicesCollection().findOne({ _id: invoiceId, ownerId: session.user.id });
    if (!invoice) return errorResponse("Invoice not found", 404);
    if (invoice.status === "cancelled") return errorResponse("Cannot pay a cancelled invoice", 409);
    if (invoice.status === "draft") return errorResponse("Cannot pay a draft invoice", 409);
    if (invoice.outstandingAmount <= 0 || invoice.status === "paid") {
      return errorResponse("Invoice is already fully paid", 409);
    }
    if (amount > invoice.outstandingAmount) {
      return errorResponse("Payment amount exceeds outstanding balance", 409);
    }

    const now = new Date();
    const reserved = await getInvoicesCollection().findOneAndUpdate(
      {
        _id: invoiceId,
        ownerId: session.user.id,
        status: { $nin: ["cancelled", "draft", "paid"] },
        outstandingAmount: { $gte: amount },
      },
      {
        $inc: { paidAmount: amount, outstandingAmount: -amount },
        $set: { updatedAt: now },
      },
      { returnDocument: "after" },
    );

    if (!reserved) return errorResponse("Payment could not be applied to the outstanding balance", 409);

    const payment: PaymentDocument = {
      ownerId: session.user.id,
      invoiceId,
      orderId: reserved.orderId,
      customerId: reserved.customerId,
      amount,
      paymentMethod: paymentMethod as PaymentMethod,
      reference,
      paymentDate,
      notes,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const inserted = await getPaymentsCollection().insertOne(payment);
      const synced = (await syncInvoiceStatus(invoiceId, session.user.id)) ?? reserved;
      return NextResponse.json(
        {
          data: {
            payment: toPaymentResponse({ ...payment, _id: inserted.insertedId }),
            invoice: toInvoiceResponse(synced),
          },
        },
        { status: 201 },
      );
    } catch (error) {
      await getInvoicesCollection().updateOne(
        { _id: invoiceId, ownerId: session.user.id },
        {
          $inc: { paidAmount: -amount, outstandingAmount: amount },
          $set: { updatedAt: new Date() },
        },
      );
      await syncInvoiceStatus(invoiceId, session.user.id);
      throw error;
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("is invalid") || error.message.includes("is required") || error.message.includes("must be") || error.message.includes("is too long")) {
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
    const id = getId((await context.params).id, "payment id");
    const payment = await getPaymentsCollection().findOne({ _id: id, ownerId: session.user.id });
    return payment ? NextResponse.json({ data: toPaymentResponse(payment) }) : errorResponse("Payment not found", 404);
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
