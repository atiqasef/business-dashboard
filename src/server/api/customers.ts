import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  customerStatuses,
  ensureCustomerIndexes,
  getCustomersCollection,
  toCustomerResponse,
  type CustomerStatus,
} from "@/server/db/models/customer";

const maxPageSize = 100;

type CustomerInput = {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  phone?: unknown;
  company?: unknown;
  address?: unknown;
  city?: unknown;
  country?: unknown;
  status?: unknown;
  notes?: unknown;
};

function textValue(value: unknown, field: string, required: true): string;
function textValue(value: unknown, field: string, required?: false): string | undefined;
function textValue(value: unknown, field: string, required = false) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${field} is required`);
    return undefined;
  }

  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const result = value.trim();
  if (required && !result) throw new Error(`${field} is required`);
  if (result.length > 500) throw new Error(`${field} is too long`);
  return result || undefined;
}

function parseCustomerInput(input: CustomerInput) {
  const firstName = textValue(input.firstName, "firstName", true);
  const lastName = textValue(input.lastName, "lastName", true);
  const emailValue = textValue(input.email, "email");
  const email = emailValue?.toLowerCase();
  const status = input.status === undefined ? "active" : input.status;

  if (!customerStatuses.includes(status as CustomerStatus)) throw new Error("status is invalid");
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error("email is invalid");

  return {
    firstName,
    lastName,
    email,
    phone: textValue(input.phone, "phone"),
    company: textValue(input.company, "company"),
    address: textValue(input.address, "address"),
    city: textValue(input.city, "city"),
    country: textValue(input.country, "country"),
    status: status as CustomerStatus,
    notes: textValue(input.notes, "notes"),
  };
}

async function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildCustomerSearchFilter(search: string) {
  const escaped = escapeRegExp(search);
  return {
    $or: [
      { firstName: { $regex: escaped, $options: "i" } },
      { lastName: { $regex: escaped, $options: "i" } },
      { email: { $regex: escaped, $options: "i" } },
      { company: { $regex: escaped, $options: "i" } },
      { phone: { $regex: escaped, $options: "i" } },
    ],
  };
}

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  const url = new URL(request.url);
  const page = Math.max(Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1, 1);
  const pageSize = Math.min(Math.max(Number.parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25, 1), maxPageSize);
  const search = url.searchParams.get("search")?.trim();
  const status = url.searchParams.get("status");

  if (status && !customerStatuses.includes(status as CustomerStatus)) return errorResponse("Invalid status filter", 400);

  try {
    await ensureCustomerIndexes();
    const filter: Record<string, unknown> = { ownerId: session.user.id };
    if (status) filter.status = status;
    if (search) Object.assign(filter, buildCustomerSearchFilter(search));

    const collection = getCustomersCollection();
    const [customers, total] = await Promise.all([
      collection.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
      collection.countDocuments(filter),
    ]);

    return NextResponse.json({
      data: customers.map(toCustomerResponse),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch {
    return errorResponse("Unable to load customers", 500);
  }
}

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  try {
    const input = parseCustomerInput((await request.json()) as CustomerInput);
    const now = new Date();
    const customer = { ...input, ownerId: session.user.id, createdAt: now, updatedAt: now };
    await ensureCustomerIndexes();
    const result = await getCustomersCollection().insertOne(customer);
    return NextResponse.json({ data: toCustomerResponse({ ...customer, _id: result.insertedId }) }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && (error.message.endsWith("is required") || error.message.endsWith("is invalid") || error.message.endsWith("must be a string") || error.message.endsWith("is too long"))) return errorResponse(error.message, 400);
    if (error && typeof error === "object" && "code" in error && error.code === 11000) return errorResponse("A customer with this email already exists", 409);
    return errorResponse("Unable to create customer", 500);
  }
}