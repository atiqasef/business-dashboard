import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { auth } from "@/lib/auth";
import { assertDemoWriteAllowed } from "@/server/auth/demo-access";
import { getCustomersCollection } from "@/server/db/models/customer";
import { getOrdersCollection } from "@/server/db/models/order";
import { getProductsCollection } from "@/server/db/models/product";
import {
  ensureInvoiceIndexes,
  getInvoicesCollection,
  invoiceStatuses,
  toInvoiceResponse,
  type InvoiceDocument,
  type InvoiceStatus,
} from "@/server/db/models/invoice";
import { ensurePaymentIndexes, getPaymentsCollection, toPaymentResponse } from "@/server/db/models/payment";
import { nextInvoiceNumber } from "@/server/db/models/invoice-sequence";
import { deriveInvoiceStatus, normalizeMoney } from "@/server/invoices/status";

const maxPageSize = 100;
const protectedFields = [
  "ownerId",
  "invoiceNumber",
  "orderId",
  "customerId",
  "subtotal",
  "total",
  "paidAmount",
  "outstandingAmount",
  "createdAt",
  "updatedAt",
  "items",
];

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function getId(value: unknown, field: string) {
  if (typeof value !== "string" || !ObjectId.isValid(value)) throw new Error(`${field} is invalid`);
  return new ObjectId(value);
}

function parseNumber(value: unknown, field: string, options: { required?: boolean; min?: number; allowZero?: boolean } = {}) {
  const { required = true, min = Number.NEGATIVE_INFINITY, allowZero = false } = options;
  if (value === undefined || value === null) {
    if (required) throw new Error(`${field} is required`);
    return undefined;
  }
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) throw new Error(`${field} must be a valid number`);
  if (numeric < min || (!allowZero && numeric === 0)) throw new Error(`${field} is invalid`);
  return numeric;
}

function parseOptionalDate(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${field} is invalid`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} is invalid`);
  return date;
}

function textValue(value: unknown, field: string, maxLength = 2000) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new Error(`${field} is too long`);
  return trimmed || undefined;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}

async function refreshOverdueStatus(ownerId: string) {
  const now = new Date();
  await getInvoicesCollection().updateMany(
    {
      ownerId,
      status: { $in: ["issued", "partially_paid"] },
      dueDate: { $lt: now },
      outstandingAmount: { $gt: 0 },
    },
    { $set: { status: "overdue", updatedAt: now } },
  );
}

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  const url = new URL(request.url);
  const page = Math.max(Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1, 1);
  const pageSize = Math.min(Math.max(Number.parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25, 1), maxPageSize);
  const search = url.searchParams.get("search")?.trim();
  const status = url.searchParams.get("status");
  const orderIdParam = url.searchParams.get("orderId");
  const customerIdParam = url.searchParams.get("customerId");

  if (status && !invoiceStatuses.includes(status as InvoiceStatus)) return errorResponse("Invalid status filter", 400);

  try {
    await ensureInvoiceIndexes();
    await refreshOverdueStatus(session.user.id);

    const filter: Record<string, unknown> = { ownerId: session.user.id };
    if (status) filter.status = status;
    if (orderIdParam) filter.orderId = getId(orderIdParam, "orderId");
    if (customerIdParam) filter.customerId = getId(customerIdParam, "customerId");
    // Payable invoices for payment recording UI — server still validates on POST /api/payments.
    if (url.searchParams.get("payable") === "1") {
      filter.status = { $nin: ["draft", "cancelled", "paid"] };
      filter.outstandingAmount = { $gt: 0 };
    }
    if (search) {
      filter.$or = [
        { invoiceNumber: { $regex: escapeRegExp(search), $options: "i" } },
        { "customerSnapshot.name": { $regex: escapeRegExp(search), $options: "i" } },
        { "customerSnapshot.email": { $regex: escapeRegExp(search), $options: "i" } },
      ];
    }

    const collection = getInvoicesCollection();
    const [invoices, total] = await Promise.all([
      collection.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
      collection.countDocuments(filter),
    ]);

    return NextResponse.json({
      data: invoices.map(toInvoiceResponse),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("is invalid")) return errorResponse(error.message, 400);
    return errorResponse("Unable to load invoices", 500);
  }
}

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);
  const demoWriteResponse = await assertDemoWriteAllowed(session.user.id);
  if (demoWriteResponse) return demoWriteResponse;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const orderId = getId(body.orderId, "orderId");
    const tax = normalizeMoney(parseNumber(body.tax ?? 0, "tax", { min: 0, allowZero: true }) ?? 0);
    const notes = textValue(body.notes, "notes");
    const dueDate = parseOptionalDate(body.dueDate, "dueDate");
    const issue = body.issue === undefined ? true : Boolean(body.issue);

    await ensureInvoiceIndexes();

    const existing = await getInvoicesCollection().findOne({
      ownerId: session.user.id,
      orderId,
      status: { $ne: "cancelled" },
    });
    if (existing) return errorResponse("An active invoice already exists for this order", 409);

    const order = await getOrdersCollection().findOne({ _id: orderId, ownerId: session.user.id });
    if (!order) return errorResponse("Order not found", 404);

    const customer = await getCustomersCollection().findOne({ _id: order.customerId, ownerId: session.user.id });
    if (!customer) return errorResponse("Customer not found", 404);

    const productIds = order.items.map((item) => item.productId);
    const products = await getProductsCollection()
      .find({ _id: { $in: productIds }, ownerId: session.user.id })
      .toArray();
    const productsById = new Map(products.map((product) => [product._id?.toHexString() ?? "", product]));

    const items = order.items.map((item) => {
      const product = productsById.get(item.productId.toHexString());
      const unitPrice = normalizeMoney(item.unitPrice);
      const lineTotal = normalizeMoney(item.lineTotal);
      return {
        productId: item.productId,
        productName: product?.name ?? "Unknown product",
        quantity: item.quantity,
        unitPrice,
        lineTotal,
      };
    });

    const subtotal = normalizeMoney(order.subtotal);
    const discount = normalizeMoney(order.discount);
    const total = normalizeMoney(subtotal - discount + tax);
    if (total < 0) throw new Error("total is invalid");

    const now = new Date();
    const issueDate = now;
    const invoiceNumber = await nextInvoiceNumber(session.user.id, issueDate);
    const status: InvoiceStatus = issue ? "issued" : "draft";

    const invoice: InvoiceDocument = {
      ownerId: session.user.id,
      invoiceNumber,
      orderId,
      customerId: order.customerId,
      customerSnapshot: {
        name: `${customer.firstName} ${customer.lastName}`.trim(),
        email: customer.email,
        phone: customer.phone,
      },
      items,
      subtotal,
      discount,
      tax,
      total,
      paidAmount: 0,
      outstandingAmount: total,
      issueDate,
      dueDate,
      status,
      notes,
      createdAt: now,
      updatedAt: now,
    };

    invoice.status = deriveInvoiceStatus(invoice, now);

    try {
      const result = await getInvoicesCollection().insertOne(invoice);
      return NextResponse.json({ data: toInvoiceResponse({ ...invoice, _id: result.insertedId }) }, { status: 201 });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) {
        return errorResponse("An active invoice already exists for this order", 409);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("is invalid") || error.message.includes("is required") || error.message.includes("must be") || error.message.includes("is too long")) {
        return errorResponse(error.message, 400);
      }
    }
    return errorResponse("Unable to create invoice", 500);
  }
}

export async function GET_BY_ID(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  try {
    await ensureInvoiceIndexes();
    await ensurePaymentIndexes();
    await refreshOverdueStatus(session.user.id);

    const id = getId((await context.params).id, "invoice id");
    const invoice = await getInvoicesCollection().findOne({ _id: id, ownerId: session.user.id });
    if (!invoice) return errorResponse("Invoice not found", 404);

    const nextStatus = deriveInvoiceStatus(invoice);
    if (nextStatus !== invoice.status) {
      await getInvoicesCollection().updateOne({ _id: id, ownerId: session.user.id }, { $set: { status: nextStatus, updatedAt: new Date() } });
      invoice.status = nextStatus;
    }

    const payments = await getPaymentsCollection()
      .find({ ownerId: session.user.id, invoiceId: id })
      .sort({ paymentDate: -1, createdAt: -1 })
      .toArray();

    return NextResponse.json({
      data: {
        ...toInvoiceResponse(invoice),
        payments: payments.map(toPaymentResponse),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("is invalid")) return errorResponse("Invalid invoice id", 400);
    return errorResponse("Unable to load invoice", 500);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);
  const demoWriteResponse = await assertDemoWriteAllowed(session.user.id);
  if (demoWriteResponse) return demoWriteResponse;

  try {
    await ensureInvoiceIndexes();
    const id = getId((await context.params).id, "invoice id");
    const invoice = await getInvoicesCollection().findOne({ _id: id, ownerId: session.user.id });
    if (!invoice) return errorResponse("Invoice not found", 404);
    if (invoice.status === "cancelled") return errorResponse("Cancelled invoices cannot be edited", 409);
    if (invoice.status === "paid") return errorResponse("Paid invoices cannot be edited", 409);

    const body = (await request.json()) as Record<string, unknown>;
    const protectedMatch = protectedFields.find((field) => field in body);
    if (protectedMatch) return errorResponse(`${protectedMatch} cannot be updated`, 400);

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    let tax = invoice.tax;
    let discount = invoice.discount;

    if ("notes" in body) updates.notes = textValue(body.notes, "notes");
    if ("dueDate" in body) updates.dueDate = parseOptionalDate(body.dueDate, "dueDate");
    if ("tax" in body) {
      tax = normalizeMoney(parseNumber(body.tax, "tax", { min: 0, allowZero: true }) ?? 0);
      updates.tax = tax;
    }
    if ("discount" in body) {
      discount = normalizeMoney(parseNumber(body.discount, "discount", { min: 0, allowZero: true }) ?? 0);
      if (discount > invoice.subtotal) throw new Error("discount cannot exceed subtotal");
      updates.discount = discount;
    }

    if ("tax" in body || "discount" in body) {
      const total = normalizeMoney(invoice.subtotal - discount + tax);
      if (total < 0) throw new Error("total is invalid");
      if (invoice.paidAmount > total) return errorResponse("Cannot reduce invoice total below amount already paid", 409);
      updates.total = total;
      updates.outstandingAmount = normalizeMoney(total - invoice.paidAmount);
    }

    if ("status" in body) {
      if (body.status !== "issued" && body.status !== "draft" && body.status !== "cancelled") {
        return errorResponse("status cannot be set directly", 400);
      }
      if (body.status === "cancelled") return errorResponse("Use cancel action to cancel an invoice", 400);
      if (invoice.paidAmount > 0 && body.status === "draft") return errorResponse("Invoices with payments cannot return to draft", 409);
      updates.status = body.status;
    }

    if (Object.keys(updates).length === 1) throw new Error("No updates supplied");

    // Condition on paidAmount so concurrent payments cannot be overwritten by a stale outstanding recalculation.
    const filter: Record<string, unknown> = {
      _id: id,
      ownerId: session.user.id,
      paidAmount: invoice.paidAmount,
    };
    if ("tax" in body || "discount" in body) {
      filter.status = { $nin: ["cancelled", "paid"] };
    }

    const result = await getInvoicesCollection().findOneAndUpdate(filter, { $set: updates }, { returnDocument: "after" });
    if (!result) {
      const current = await getInvoicesCollection().findOne({ _id: id, ownerId: session.user.id });
      if (!current) return errorResponse("Invoice not found", 404);
      return errorResponse("Invoice was updated concurrently; refresh and try again", 409);
    }

    const nextStatus = deriveInvoiceStatus(result);
    if (nextStatus !== result.status) {
      const refreshed = await getInvoicesCollection().findOneAndUpdate(
        { _id: id, ownerId: session.user.id },
        { $set: { status: nextStatus, updatedAt: new Date() } },
        { returnDocument: "after" },
      );
      return NextResponse.json({ data: toInvoiceResponse(refreshed ?? result) });
    }

    return NextResponse.json({ data: toInvoiceResponse(result) });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "No updates supplied") return errorResponse(error.message, 400);
      if (error.message.includes("is invalid") || error.message.includes("is required") || error.message.includes("must be") || error.message.includes("cannot exceed")) {
        return errorResponse(error.message, 400);
      }
    }
    return errorResponse("Unable to update invoice", 500);
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
    const id = getId((await context.params).id, "invoice id");
    const invoice = await getInvoicesCollection().findOne({ _id: id, ownerId: session.user.id });
    if (!invoice) return errorResponse("Invoice not found", 404);
    if (invoice.status === "cancelled") return errorResponse("Invoice is already cancelled", 409);
    if (invoice.status === "paid" || invoice.paidAmount > 0) {
      return errorResponse("Invoices with payments cannot be cancelled", 409);
    }

    const activePayments = await getPaymentsCollection().countDocuments({
      ownerId: session.user.id,
      invoiceId: id,
      voidedAt: { $exists: false },
    });
    if (activePayments > 0) return errorResponse("Invoices with payments cannot be cancelled", 409);

    const result = await getInvoicesCollection().findOneAndUpdate(
      { _id: id, ownerId: session.user.id, paidAmount: 0 },
      { $set: { status: "cancelled", outstandingAmount: 0, updatedAt: new Date() } },
      { returnDocument: "after" },
    );

    if (!result) return errorResponse("Unable to cancel invoice", 409);
    return NextResponse.json({ data: toInvoiceResponse(result) });
  } catch (error) {
    if (error instanceof Error && error.message.includes("is invalid")) return errorResponse("Invalid invoice id", 400);
    return errorResponse("Unable to cancel invoice", 500);
  }
}
