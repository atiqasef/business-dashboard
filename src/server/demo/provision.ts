import { ObjectId, type Collection, type Document, type Filter } from "mongodb";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEMO_EMAIL, DEMO_NAME, DEMO_PASSWORD, DEMO_ROLE, DEMO_SEED_KEY, DEMO_SEED_VERSION } from "@/server/demo/constants";
import { ensureDemoAccount, ensureDemoAccountIndexes, getDemoAccountsCollection } from "@/server/db/models/demo-account";
import { ensureDemoSeedIndexes, getDemoSeedsCollection } from "@/server/db/models/demo-seed";
import { ensureCustomerIndexes, getCustomersCollection, type CustomerDocument } from "@/server/db/models/customer";
import { ensureProductIndexes, getProductsCollection, type ProductDocument } from "@/server/db/models/product";
import { ensureOrderIndexes, getOrdersCollection, type OrderDocument } from "@/server/db/models/order";

type AuthUserDocument = {
  id: string;
  email: string;
};

const customerIds = {
  maya: new ObjectId("65f000000000000000000001"),
  leon: new ObjectId("65f000000000000000000002"),
  priya: new ObjectId("65f000000000000000000003"),
  theo: new ObjectId("65f000000000000000000004"),
};

const productIds = {
  notebook: new ObjectId("65f000000000000000000101"),
  lamp: new ObjectId("65f000000000000000000102"),
  planner: new ObjectId("65f000000000000000000103"),
  tote: new ObjectId("65f000000000000000000104"),
};

const orderIds = [
  new ObjectId("65f000000000000000000201"),
  new ObjectId("65f000000000000000000202"),
  new ObjectId("65f000000000000000000203"),
];

const date = (value: string) => new Date(`${value}T12:00:00.000Z`);

async function getOrCreateDemoUser() {
  const users = db.collection<AuthUserDocument>("user");
  const existing = await users.findOne({ email: DEMO_EMAIL }, { projection: { id: 1, email: 1 } });

  if (existing) {
    const demoAccount = await getDemoAccountsCollection().findOne({ userId: existing.id });
    if (!demoAccount || demoAccount.role !== DEMO_ROLE) {
      throw new Error("The reserved demo email belongs to an account that is not the demo account");
    }
    return existing.id;
  }

  const result = await auth.api.createUser({
    body: {
      email: DEMO_EMAIL,
      name: DEMO_NAME,
      password: DEMO_PASSWORD,
    },
  });

  return result.user.id;
}

type DemoOwnedDocument = Document & { _id: ObjectId; ownerId: string };

async function upsertOwnedDocument(
  collection: Collection<DemoOwnedDocument>,
  document: DemoOwnedDocument,
  userId: string,
) {
  const existing = await collection.findOne({ _id: document._id } as Filter<DemoOwnedDocument>);
  if (existing && (existing as DemoOwnedDocument).ownerId !== userId) {
    throw new Error("A demo fixture ID belongs to another owner");
  }

  await collection.updateOne(
    { _id: document._id, ownerId: userId } as Filter<DemoOwnedDocument>,
    { $setOnInsert: document },
    { upsert: true },
  );
}

async function seedCustomers(userId: string) {
  const customers: CustomerDocument[] = [
    { _id: customerIds.maya, ownerId: userId, firstName: "Maya", lastName: "Chen", email: "maya.chen@example.com", phone: "+1 555 010 2201", company: "Northstar Atelier", address: "14 Willow Lane", city: "Portland", country: "United States", status: "active", notes: "Fictional demo customer", createdAt: date("2026-01-08"), updatedAt: date("2026-02-12") },
    { _id: customerIds.leon, ownerId: userId, firstName: "Leon", lastName: "Okafor", email: "leon.okafor@example.com", phone: "+1 555 010 2202", company: "Brightline Studio", address: "88 Harbor Street", city: "Boston", country: "United States", status: "active", notes: "Fictional demo customer", createdAt: date("2026-01-15"), updatedAt: date("2026-02-18") },
    { _id: customerIds.priya, ownerId: userId, firstName: "Priya", lastName: "Nair", email: "priya.nair@example.com", phone: "+1 555 010 2203", company: "Juniper & Co.", address: "203 Garden Road", city: "Austin", country: "United States", status: "active", notes: "Fictional demo customer", createdAt: date("2026-02-02"), updatedAt: date("2026-02-20") },
    { _id: customerIds.theo, ownerId: userId, firstName: "Theo", lastName: "Meyer", email: "theo.meyer@example.com", phone: "+1 555 010 2204", company: "Paper Kite Goods", address: "7 Market Walk", city: "Chicago", country: "United States", status: "inactive", notes: "Fictional demo customer", createdAt: date("2026-02-10"), updatedAt: date("2026-02-21") },
  ];

  const collection = getCustomersCollection();
  for (const customer of customers) {
    const conflict = await collection.findOne({ ownerId: userId, email: customer.email, _id: { $ne: customer._id } });
    if (conflict) throw new Error("A demo customer email conflicts with an existing demo record");
    await upsertOwnedDocument(collection as unknown as Collection<DemoOwnedDocument>, customer as DemoOwnedDocument, userId);
  }
}

async function seedProducts(userId: string) {
  const products: ProductDocument[] = [
    { _id: productIds.notebook, ownerId: userId, name: "Field Notes Notebook", description: "Fictional recycled-paper notebook for daily planning.", sku: "DEMO-NOTE-001", price: 18, costPrice: 7, stock: 42, category: "Stationery", status: "active", createdAt: date("2026-01-05"), updatedAt: date("2026-02-12") },
    { _id: productIds.lamp, ownerId: userId, name: "Harbor Desk Lamp", description: "Fictional compact lamp with a warm reading light.", sku: "DEMO-LAMP-002", price: 64, costPrice: 28, stock: 16, category: "Workspace", status: "active", createdAt: date("2026-01-11"), updatedAt: date("2026-02-17") },
    { _id: productIds.planner, ownerId: userId, name: "Quarterly Focus Planner", description: "Fictional undated planner for quarterly goals.", sku: "DEMO-PLAN-003", price: 26, costPrice: 10, stock: 31, category: "Stationery", status: "active", createdAt: date("2026-01-19"), updatedAt: date("2026-02-19") },
    { _id: productIds.tote, ownerId: userId, name: "Canvas Market Tote", description: "Fictional reinforced canvas carryall.", sku: "DEMO-TOTE-004", price: 34, costPrice: 15, stock: 8, category: "Accessories", status: "inactive", createdAt: date("2026-02-04"), updatedAt: date("2026-02-15") },
  ];

  const collection = getProductsCollection();
  for (const product of products) {
    const conflict = await collection.findOne({ ownerId: userId, sku: product.sku, _id: { $ne: product._id } });
    if (conflict) throw new Error("A demo product SKU conflicts with an existing demo record");
    await upsertOwnedDocument(collection as unknown as Collection<DemoOwnedDocument>, product as DemoOwnedDocument, userId);
  }
}

async function seedOrders(userId: string) {
  const orders: OrderDocument[] = [
    { _id: orderIds[0], ownerId: userId, customerId: customerIds.maya, items: [{ productId: productIds.notebook, quantity: 2, unitPrice: 18, lineTotal: 36 }, { productId: productIds.planner, quantity: 1, unitPrice: 26, lineTotal: 26 }], subtotal: 62, discount: 0, total: 62, status: "completed", createdAt: date("2026-02-12"), updatedAt: date("2026-02-12") },
    { _id: orderIds[1], ownerId: userId, customerId: customerIds.leon, items: [{ productId: productIds.lamp, quantity: 1, unitPrice: 64, lineTotal: 64 }, { productId: productIds.tote, quantity: 1, unitPrice: 34, lineTotal: 34 }], subtotal: 98, discount: 8, total: 90, status: "confirmed", createdAt: date("2026-02-18"), updatedAt: date("2026-02-18") },
    { _id: orderIds[2], ownerId: userId, customerId: customerIds.priya, items: [{ productId: productIds.planner, quantity: 3, unitPrice: 26, lineTotal: 78 }], subtotal: 78, discount: 0, total: 78, status: "pending", createdAt: date("2026-02-20"), updatedAt: date("2026-02-20") },
  ];

  const customers = await getCustomersCollection().countDocuments({ ownerId: userId, _id: { $in: Object.values(customerIds) } });
  const products = await getProductsCollection().countDocuments({ ownerId: userId, _id: { $in: Object.values(productIds) } });
  if (customers !== Object.values(customerIds).length || products !== Object.values(productIds).length) {
    throw new Error("Demo order relationships are not fully owned by the demo account");
  }

  const collection = getOrdersCollection();
  for (const order of orders) await upsertOwnedDocument(collection as unknown as Collection<DemoOwnedDocument>, order as DemoOwnedDocument, userId);
}

export async function provisionDemo() {
  await ensureDemoAccountIndexes();
  await ensureDemoSeedIndexes();
  await ensureCustomerIndexes();
  await ensureProductIndexes();
  await ensureOrderIndexes();

  const userId = await getOrCreateDemoUser();
  await ensureDemoAccount(userId);

  const existingSeed = await getDemoSeedsCollection().findOne({ seedKey: DEMO_SEED_KEY });
  if (existingSeed && existingSeed.userId !== userId) {
    throw new Error("The demo seed is already assigned to another user");
  }

  await seedCustomers(userId);
  await seedProducts(userId);
  await seedOrders(userId);

  const now = new Date();
  await getDemoSeedsCollection().updateOne(
    { seedKey: DEMO_SEED_KEY },
    { $set: { version: DEMO_SEED_VERSION, userId, updatedAt: now }, $setOnInsert: { seedKey: DEMO_SEED_KEY, createdAt: now } },
    { upsert: true },
  );
}