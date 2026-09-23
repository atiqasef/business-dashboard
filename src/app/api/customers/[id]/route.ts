import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { auth } from "@/lib/auth";
import { customerStatuses, ensureCustomerIndexes, getCustomersCollection, toCustomerResponse, type CustomerStatus } from "@/server/db/models/customer";

type RouteContext = { params: Promise<{ id: string }> };
type CustomerInput = Record<string, unknown>;

async function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function getId(id: string) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

function parseUpdates(input: CustomerInput) {
  const allowed = ["firstName", "lastName", "email", "phone", "company", "address", "city", "country", "status", "notes"];
  const updates: Record<string, string | undefined> = {};
  for (const field of allowed) {
    if (!(field in input)) continue;
    const value = input[field];
    if (typeof value !== "string") throw new Error(`${field} must be a string`);
    const trimmed = value.trim();
    if (["firstName", "lastName"].includes(field) && !trimmed) throw new Error(`${field} is required`);
    if (trimmed.length > 500) throw new Error(`${field} is too long`);
    updates[field] = trimmed || undefined;
  }
  if (updates.email) {
    updates.email = updates.email.toLowerCase();
    if (updates.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) throw new Error("email is invalid");
  }
  if (updates.status && !customerStatuses.includes(updates.status as CustomerStatus)) throw new Error("status is invalid");
  if (!Object.keys(updates).length) throw new Error("No updates supplied");
  return updates;
}

export async function GET(request: Request, context: RouteContext) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);
  const id = getId((await context.params).id);
  if (!id) return errorResponse("Invalid customer id", 400);
  try {
    const customer = await getCustomersCollection().findOne({ _id: id, ownerId: session.user.id });
    return customer ? NextResponse.json({ data: toCustomerResponse(customer) }) : errorResponse("Customer not found", 404);
  } catch {
    return errorResponse("Unable to load customer", 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);
  const id = getId((await context.params).id);
  if (!id) return errorResponse("Invalid customer id", 400);
  try {
    const updates = parseUpdates((await request.json()) as CustomerInput);
    await ensureCustomerIndexes();
    const result = await getCustomersCollection().findOneAndUpdate(
      { _id: id, ownerId: session.user.id },
      { $set: { ...updates, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    return result ? NextResponse.json({ data: toCustomerResponse(result) }) : errorResponse("Customer not found", 404);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) return errorResponse("A customer with this email already exists", 409);
    if (error instanceof Error && error.message !== "No updates supplied") return errorResponse(error.message, 400);
    return errorResponse("Unable to update customer", 400);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);
  const id = getId((await context.params).id);
  if (!id) return errorResponse("Invalid customer id", 400);
  try {
    const result = await getCustomersCollection().deleteOne({ _id: id, ownerId: session.user.id });
    return result.deletedCount ? new NextResponse(null, { status: 204 }) : errorResponse("Customer not found", 404);
  } catch {
    return errorResponse("Unable to delete customer", 500);
  }
}