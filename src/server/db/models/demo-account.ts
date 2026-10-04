import { type Collection } from "mongodb";
import { db } from "@/lib/db";

export const demoAccountRoles = ["read-only-demo"] as const;
export type DemoAccountRole = (typeof demoAccountRoles)[number];

export interface DemoAccountDocument {
  userId: string;
  role: DemoAccountRole;
  createdAt: Date;
}

let indexesPromise: Promise<void> | null = null;

export function getDemoAccountsCollection(): Collection<DemoAccountDocument> {
  return db.collection<DemoAccountDocument>("demoAccounts");
}

export async function ensureDemoAccountIndexes() {
  if (!indexesPromise) {
    indexesPromise = getDemoAccountsCollection()
      .createIndex({ userId: 1 }, { name: "user_id_unique", unique: true })
      .then(() => undefined);
  }

  return indexesPromise;
}

export async function isReadOnlyDemoUser(userId: string) {
  await ensureDemoAccountIndexes();
  return Boolean(await getDemoAccountsCollection().findOne({ userId, role: "read-only-demo" }, { projection: { _id: 1 } }));
}

export async function ensureDemoAccount(userId: string) {
  await ensureDemoAccountIndexes();
  const existing = await getDemoAccountsCollection().findOne({ userId });
  if (existing && existing.role !== "read-only-demo") {
    throw new Error("Demo account has an unexpected role");
  }

  await getDemoAccountsCollection().updateOne(
    { userId },
    { $setOnInsert: { userId, role: "read-only-demo", createdAt: new Date() } },
    { upsert: true },
  );
}
