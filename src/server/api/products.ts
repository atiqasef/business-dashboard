import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { auth } from "@/lib/auth";
import {
  ensureProductIndexes,
  getProductsCollection,
  productStatuses,
  toProductResponse,
  type ProductStatus,
} from "@/server/db/models/product";

const maxPageSize = 100;

type ProductInput = {
  name?: unknown;
  description?: unknown;
  sku?: unknown;
  price?: unknown;
  costPrice?: unknown;
  stock?: unknown;
  category?: unknown;
  status?: unknown;
};

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function textValue(value: unknown, field: string, required: true, maxLength: number): string;
function textValue(value: unknown, field: string, required?: false, maxLength?: number): string | undefined;
function textValue(value: unknown, field: string, required = false, maxLength = 500) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${field} is required`);
    return undefined;
  }

  if (typeof value !== "string") throw new Error(`${field} must be a string`);

  const result = value.trim();
  if (required && !result) throw new Error(`${field} is required`);
  if (result.length > maxLength) throw new Error(`${field} is too long`);

  return result || undefined;
}

function parseNumber(value: unknown, field: string, options?: { required?: boolean; integer?: boolean; min?: number; allowZero?: boolean }): number | undefined {
  const { required = true, integer = false, min = Number.NEGATIVE_INFINITY, allowZero = false } = options ?? {};

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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildProductSearchFilter(search: string) {
  const escaped = escapeRegExp(search);
  return {
    $or: [
      { name: { $regex: escaped, $options: "i" } },
      { sku: { $regex: escaped, $options: "i" } },
      { category: { $regex: escaped, $options: "i" } },
      { description: { $regex: escaped, $options: "i" } },
    ],
  };
}

function parseProductInput(input: ProductInput) {
  const name = textValue(input.name, "name", true, 200);
  const description = textValue(input.description, "description", false, 2000);
  const sku = textValue(input.sku, "sku", true, 100);
  const priceValue = parseNumber(input.price, "price", { min: 0, allowZero: false });
  const costPriceValue = parseNumber(input.costPrice, "costPrice", { required: false, min: 0, allowZero: true });
  const stockValue = parseNumber(input.stock, "stock", { min: 0, integer: true, allowZero: true });
  const category = textValue(input.category, "category", false, 100);
  const status = input.status === undefined ? "active" : input.status;

  if (typeof status !== "string" || !productStatuses.includes(status as ProductStatus)) {
    throw new Error("status is invalid");
  }

  if (typeof priceValue !== "number" || !Number.isFinite(priceValue) || priceValue <= 0) {
    throw new Error("price must be a positive number");
  }

  if (costPriceValue !== undefined && (!Number.isFinite(costPriceValue) || costPriceValue < 0)) {
    throw new Error("costPrice must be a non-negative number");
  }

  if (typeof stockValue !== "number" || !Number.isInteger(stockValue) || stockValue < 0) {
    throw new Error("stock must be a non-negative integer");
  }

  return {
    name,
    description,
    sku,
    price: priceValue,
    costPrice: costPriceValue,
    stock: stockValue,
    category,
    status: status as ProductStatus,
  };
}

function getId(id: string) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

async function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  const url = new URL(request.url);
  const page = Math.max(Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1, 1);
  const pageSize = Math.min(Math.max(Number.parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25, 1), maxPageSize);
  const search = url.searchParams.get("search")?.trim();
  const status = url.searchParams.get("status");

  if (status && !productStatuses.includes(status as ProductStatus)) return errorResponse("Invalid status filter", 400);

  try {
    await ensureProductIndexes();

    const filter: Record<string, unknown> = { ownerId: session.user.id };
    if (status) filter.status = status;
    if (search) Object.assign(filter, buildProductSearchFilter(search));

    const collection = getProductsCollection();
    const [products, total] = await Promise.all([
      collection.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
      collection.countDocuments(filter),
    ]);

    return NextResponse.json({
      data: products.map(toProductResponse),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch {
    return errorResponse("Unable to load products", 500);
  }
}

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  try {
    const input = parseProductInput((await request.json()) as ProductInput);
    const now = new Date();
    const product = { ...input, ownerId: session.user.id, createdAt: now, updatedAt: now };

    await ensureProductIndexes();
    const result = await getProductsCollection().insertOne(product);

    return NextResponse.json({ data: toProductResponse({ ...product, _id: result.insertedId }) }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && (error.message.endsWith("is required") || error.message.endsWith("is invalid") || error.message.endsWith("must be a string") || error.message.endsWith("must be a valid number") || error.message.endsWith("must be a whole number") || error.message.endsWith("is too long"))) {
      return errorResponse(error.message, 400);
    }
    if (error && typeof error === "object" && "code" in error && error.code === 11000) return errorResponse("A product with this SKU already exists", 409);
    return errorResponse("Unable to create product", 500);
  }
}

export async function GET_BY_ID(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  const id = getId((await context.params).id);
  if (!id) return errorResponse("Invalid product id", 400);

  try {
    const product = await getProductsCollection().findOne({ _id: id, ownerId: session.user.id });
    return product ? NextResponse.json({ data: toProductResponse(product) }) : errorResponse("Product not found", 404);
  } catch {
    return errorResponse("Unable to load product", 500);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  const id = getId((await context.params).id);
  if (!id) return errorResponse("Invalid product id", 400);

  try {
    const input = (await request.json()) as ProductInput;
    const allowed = ["name", "description", "sku", "price", "costPrice", "stock", "category", "status"];
    const updates: Record<string, unknown> = {};

    for (const field of allowed) {
      if (!(field in input)) continue;
      const value = input[field as keyof ProductInput];

      if (field === "name") {
        updates.name = textValue(value, "name", true, 200);
      } else if (field === "description") {
        updates.description = textValue(value, "description", false, 2000) ?? undefined;
      } else if (field === "sku") {
        updates.sku = textValue(value, "sku", true, 100);
      } else if (field === "price") {
        updates.price = parseNumber(value, "price", { min: 0, allowZero: false });
      } else if (field === "costPrice") {
        updates.costPrice = parseNumber(value, "costPrice", { required: false, min: 0, allowZero: true });
      } else if (field === "stock") {
        updates.stock = parseNumber(value, "stock", { min: 0, integer: true, allowZero: true });
      } else if (field === "category") {
        updates.category = textValue(value, "category", false, 100) ?? undefined;
      } else if (field === "status") {
        const statusValue = value;
        if (typeof statusValue !== "string" || !productStatuses.includes(statusValue as ProductStatus)) {
          throw new Error("status is invalid");
        }
        updates.status = statusValue;
      }
    }

    if (!Object.keys(updates).length) throw new Error("No updates supplied");

    await ensureProductIndexes();
    const result = await getProductsCollection().findOneAndUpdate(
      { _id: id, ownerId: session.user.id },
      { $set: { ...updates, updatedAt: new Date() } },
      { returnDocument: "after" },
    );

    return result ? NextResponse.json({ data: toProductResponse(result) }) : errorResponse("Product not found", 404);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) return errorResponse("A product with this SKU already exists", 409);
    if (error instanceof Error && error.message !== "No updates supplied") return errorResponse(error.message, 400);
    return errorResponse("Unable to update product", 400);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  const id = getId((await context.params).id);
  if (!id) return errorResponse("Invalid product id", 400);

  try {
    const result = await getProductsCollection().deleteOne({ _id: id, ownerId: session.user.id });
    return result.deletedCount ? new NextResponse(null, { status: 204 }) : errorResponse("Product not found", 404);
  } catch {
    return errorResponse("Unable to delete product", 500);
  }
}
