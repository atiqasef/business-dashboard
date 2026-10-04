import { ObjectId } from "mongodb";
import { ensureDemoAccount } from "@/server/db/models/demo-account";
import { ensureCustomerIndexes, getCustomersCollection } from "@/server/db/models/customer";
import { ensureProductIndexes, getProductsCollection } from "@/server/db/models/product";
import { ensureOrderIndexes, getOrdersCollection } from "@/server/db/models/order";
import { demoUser } from "./auth";

export async function markDemoUser(userId = demoUser.id) {
  await ensureDemoAccount(userId);
}

export async function seedCustomer(ownerId: string, overrides: Record<string, unknown> = {}) {
  await ensureCustomerIndexes();
  const now = new Date();
  const document = {
    ownerId,
    firstName: "Ada",
    lastName: "Lovelace",
    email: `ada-${ownerId}-${new ObjectId().toHexString().slice(-6)}@example.test`,
    phone: "+1 555 0100",
    company: "Analytical Engines",
    address: "1 Computation Way",
    city: "London",
    country: "United Kingdom",
    status: "active" as const,
    notes: "fixture",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };

  const result = await getCustomersCollection().insertOne(document);
  return { ...document, _id: result.insertedId, id: result.insertedId.toHexString() };
}

export async function seedProduct(ownerId: string, overrides: Record<string, unknown> = {}) {
  await ensureProductIndexes();
  const now = new Date();
  const document = {
    ownerId,
    name: "Notebook",
    description: "Fixture notebook",
    sku: `SKU-${ownerId}-${new ObjectId().toHexString().slice(-6)}`.toUpperCase(),
    price: 20,
    costPrice: 8,
    stock: 10,
    category: "Stationery",
    status: "active" as const,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };

  const result = await getProductsCollection().insertOne(document);
  return { ...document, _id: result.insertedId, id: result.insertedId.toHexString() };
}

export async function seedOrder(
  ownerId: string,
  customerId: ObjectId,
  productId: ObjectId,
  overrides: Record<string, unknown> = {},
) {
  await ensureOrderIndexes();
  const now = new Date();
  const unitPrice = 20;
  const quantity = 2;
  const subtotal = unitPrice * quantity;
  const discount = 0;
  const document = {
    ownerId,
    customerId,
    items: [
      {
        productId,
        quantity,
        unitPrice,
        lineTotal: subtotal,
      },
    ],
    subtotal,
    discount,
    total: subtotal - discount,
    status: "pending" as const,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };

  const result = await getOrdersCollection().insertOne(document);
  return { ...document, _id: result.insertedId, id: result.insertedId.toHexString() };
}
