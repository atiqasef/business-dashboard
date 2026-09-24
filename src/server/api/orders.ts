import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { auth } from "@/lib/auth";
import { getCustomersCollection } from "@/server/db/models/customer";
import { getProductsCollection } from "@/server/db/models/product";
import {
  ensureOrderIndexes,
  getOrdersCollection,
  orderStatuses,
  toOrderResponse,
  type OrderDocument,
  type OrderItem,
  type OrderStatus,
} from "@/server/db/models/order";

const maxPageSize = 100;

type OrderInput = Record<string, unknown>;

type NormalizedOrderItem = {
  productId: ObjectId;
  quantity: number;
};

type FinancialBreakdown = {
  items: OrderItem[];
  subtotal: number;
  total: number;
  discount: number;
};

const protectedFields = ["ownerId", "createdAt", "updatedAt", "unitPrice", "lineTotal", "subtotal", "total"];

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeMoney(value: number) {
  return Number(Number(value).toFixed(2));
}

function getId(value: unknown, field: string) {
  if (typeof value !== "string" || !ObjectId.isValid(value)) {
    throw new Error(`${field} is invalid`);
  }
  return new ObjectId(value);
}

function parseNumber(value: unknown, field: string, options: { required?: boolean; min?: number; integer?: boolean; allowZero?: boolean } = {}) {
  const { required = true, min = Number.NEGATIVE_INFINITY, integer = false, allowZero = false } = options;

  if (value === undefined || value === null) {
    if (required) throw new Error(`${field} is required`);
    return undefined;
  }

  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) throw new Error(`${field} must be a valid number`);
  if (integer && !Number.isInteger(numeric)) throw new Error(`${field} must be a whole number`);
  if (numeric < min || (!allowZero && numeric === 0)) {
    throw new Error(`${field} is invalid`);
  }

  return numeric;
}

function parseDiscount(value: unknown, field = "discount") {
  const result = parseNumber(value, field, { min: 0, allowZero: true });
  if (result === undefined) return 0;
  if (!Number.isFinite(result) || result < 0) throw new Error(`${field} is invalid`);
  return normalizeMoney(result);
}

function parseStatus(value: unknown) {
  if (typeof value !== "string" || !orderStatuses.includes(value as OrderStatus)) {
    throw new Error("status is invalid");
  }
  return value as OrderStatus;
}

function parseOrderItem(value: unknown, index: number): NormalizedOrderItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`items[${index}] must be an object`);
  }

  const item = value as Record<string, unknown>;
  const productId = getId(item.productId, `items[${index}].productId`);
  const quantity = parseNumber(item.quantity, `items[${index}].quantity`, { min: 1, integer: true, allowZero: false });

  return {
    productId,
    quantity: Number(quantity),
  };
}

function parseItemList(value: unknown) {
  if (!Array.isArray(value)) throw new Error("items must be an array");
  if (value.length === 0) throw new Error("items is required");

  const items = value.map((item, index) => parseOrderItem(item, index));
  const seen = new Set<string>();

  for (const item of items) {
    const key = item.productId.toHexString();
    if (seen.has(key)) throw new Error("Duplicate product IDs are not allowed");
    seen.add(key);
  }

  return items;
}

async function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}

async function validateOwnedCustomer(sessionUserId: string, customerId: ObjectId) {
  const customer = await getCustomersCollection().findOne({ _id: customerId, ownerId: sessionUserId });
  if (!customer) throw new Error("Customer not found");
  return customer;
}

async function validateOwnedProducts(sessionUserId: string, items: NormalizedOrderItem[]) {
  const productIds = items.map((item) => item.productId);
  const products = await getProductsCollection().find({ _id: { $in: productIds }, ownerId: sessionUserId }).toArray();
  const map = new Map(products.map((product) => [product._id?.toString() ?? "", product]));

  for (const item of items) {
    const product = map.get(item.productId.toHexString());
    if (!product) throw new Error("Product not found");
  }

  return products;
}

async function buildFinancialBreakdown(sessionUserId: string, items: NormalizedOrderItem[], discountValue: number): Promise<FinancialBreakdown> {
  const products = await validateOwnedProducts(sessionUserId, items);
  const productsById = new Map(products.map((product) => [product._id?.toString() ?? "", product]));
  const orderItems: OrderItem[] = [];
  let subtotal = 0;

  for (const item of items) {
    const product = productsById.get(item.productId.toHexString());
    if (!product) throw new Error("Product not found");

    const unitPrice = normalizeMoney(product.price);
    const lineTotal = normalizeMoney(unitPrice * item.quantity);
    orderItems.push({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice,
      lineTotal,
    });
    subtotal = normalizeMoney(subtotal + lineTotal);
  }

  const discount = normalizeMoney(discountValue);
  if (discount < 0) throw new Error("discount is invalid");
  if (discount > subtotal) throw new Error("discount cannot exceed subtotal");

  const total = normalizeMoney(subtotal - discount);
  if (!Number.isFinite(total) || total < 0) throw new Error("total is invalid");

  return { items: orderItems, subtotal, total, discount };
}

async function parseCreateInput(request: Request) {
  const body = (await request.json()) as OrderInput;
  const customerId = getId(body.customerId, "customerId");
  const items = parseItemList(body.items);
  const discount = parseDiscount(body.discount ?? 0, "discount");
  const status = parseStatus(body.status ?? "pending");

  return { customerId, items, discount, status };
}

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  const url = new URL(request.url);
  const page = Math.max(Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1, 1);
  const pageSize = Math.min(Math.max(Number.parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25, 1), maxPageSize);
  const status = url.searchParams.get("status");

  if (status && !orderStatuses.includes(status as OrderStatus)) {
    return errorResponse("Invalid status filter", 400);
  }

  try {
    await ensureOrderIndexes();
    const filter: Record<string, unknown> = { ownerId: session.user.id };
    if (status) filter.status = status;

    const collection = getOrdersCollection();
    const [orders, total] = await Promise.all([
      collection.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
      collection.countDocuments(filter),
    ]);

    return NextResponse.json({
      data: orders.map(toOrderResponse),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch {
    return errorResponse("Unable to load orders", 500);
  }
}

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  try {
    const input = await parseCreateInput(request);
    await validateOwnedCustomer(session.user.id, input.customerId);
    const financial = await buildFinancialBreakdown(session.user.id, input.items, input.discount);

    const now = new Date();
    const order: OrderDocument = {
      ownerId: session.user.id,
      customerId: input.customerId,
      items: financial.items,
      subtotal: financial.subtotal,
      discount: financial.discount,
      total: financial.total,
      status: input.status,
      createdAt: now,
      updatedAt: now,
    };

    await ensureOrderIndexes();
    const result = await getOrdersCollection().insertOne(order);
    return NextResponse.json({ data: toOrderResponse({ ...order, _id: result.insertedId }) }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Customer not found") return errorResponse(error.message, 404);
      if (error.message === "Product not found") return errorResponse(error.message, 404);
      if (error.message === "Duplicate product IDs are not allowed") return errorResponse(error.message, 400);
      if (error.message.includes("is invalid") || error.message.includes("is required") || error.message.includes("must be") || error.message.includes("is too long") || error.message.includes("cannot exceed subtotal") || error.message.includes("must be an array") || error.message.includes("must be an object") || error.message.includes("is invalid") || error.message.includes("No updates supplied")) {
        return errorResponse(error.message, 400);
      }
    }
    return errorResponse("Unable to create order", 500);
  }
}

export async function GET_BY_ID(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  try {
    const id = getId((await context.params).id, "order id");
    const order = await getOrdersCollection().findOne({ _id: id, ownerId: session.user.id });
    return order ? NextResponse.json({ data: toOrderResponse(order) }) : errorResponse("Order not found", 404);
  } catch (error) {
    if (error instanceof Error && error.message.includes("is invalid")) return errorResponse("Invalid order id", 400);
    return errorResponse("Unable to load order", 500);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  try {
    const id = getId((await context.params).id, "order id");
    const original = await getOrdersCollection().findOne({ _id: id, ownerId: session.user.id });
    if (!original) return errorResponse("Order not found", 404);

    const input = (await request.json()) as OrderInput;
    const protectedMatch = protectedFields.find((field) => field in input);
    if (protectedMatch) return errorResponse(`${protectedMatch} cannot be updated`, 400);

    const allowed = ["customerId", "items", "discount", "status"];
    const requested = Object.keys(input).filter((field) => allowed.includes(field));
    if (!requested.length) throw new Error("No updates supplied");

    const update: Record<string, unknown> = { updatedAt: new Date() };

    if ("customerId" in input) {
      const customerId = getId(input.customerId, "customerId");
      await validateOwnedCustomer(session.user.id, customerId);
      update.customerId = customerId;
    }

    if ("status" in input) {
      update.status = parseStatus(input.status);
    }

    if ("items" in input) {
      const parsedItems = parseItemList(input.items);
      const discountValue = "discount" in input ? parseDiscount(input.discount, "discount") : original.discount;
      const financial = await buildFinancialBreakdown(session.user.id, parsedItems, discountValue);
      update.items = financial.items;
      update.subtotal = financial.subtotal;
      update.discount = financial.discount;
      update.total = financial.total;
    }

    if ("discount" in input && !("items" in input)) {
      const discountValue = parseDiscount(input.discount, "discount");
      if (discountValue > original.subtotal) throw new Error("discount cannot exceed subtotal");
      update.discount = discountValue;
      update.total = normalizeMoney(original.subtotal - discountValue);
    }

    if (Object.keys(update).length === 1 && "updatedAt" in update) {
      throw new Error("No updates supplied");
    }

    await ensureOrderIndexes();
    const result = await getOrdersCollection().findOneAndUpdate(
      { _id: id, ownerId: session.user.id },
      { $set: update },
      { returnDocument: "after" },
    );

    return result ? NextResponse.json({ data: toOrderResponse(result) }) : errorResponse("Order not found", 404);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Customer not found") return errorResponse(error.message, 404);
      if (error.message === "Product not found") return errorResponse(error.message, 404);
      if (error.message === "No updates supplied") return errorResponse(error.message, 400);
      if (error.message.includes("is invalid") || error.message.includes("is required") || error.message.includes("must be") || error.message.includes("cannot exceed subtotal") || error.message.includes("must be an array") || error.message.includes("must be an object") || error.message.includes("Duplicate product IDs are not allowed") || error.message.includes("cannot be updated")) {
        return errorResponse(error.message, 400);
      }
    }
    return errorResponse("Unable to update order", 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  try {
    const id = getId((await context.params).id, "order id");
    const result = await getOrdersCollection().deleteOne({ _id: id, ownerId: session.user.id });
    return result.deletedCount ? new NextResponse(null, { status: 204 }) : errorResponse("Order not found", 404);
  } catch (error) {
    if (error instanceof Error && error.message.includes("is invalid")) return errorResponse("Invalid order id", 400);
    return errorResponse("Unable to delete order", 500);
  }
}
