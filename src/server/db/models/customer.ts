import { ObjectId, type Collection } from "mongodb";
import { db } from "@/lib/db";

export const customerStatuses = ["active", "inactive"] as const;
export type CustomerStatus = (typeof customerStatuses)[number];

export interface CustomerDocument {
  _id?: ObjectId;
  ownerId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  company?: string;
  address?: string;
  city?: string;
  country?: string;
  status: CustomerStatus;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

let indexesPromise: Promise<void> | null = null;

export function getCustomersCollection(): Collection<CustomerDocument> {
  return db.collection<CustomerDocument>("customers");
}

export async function ensureCustomerIndexes() {
  if (!indexesPromise) {
    indexesPromise = getCustomersCollection()
      .createIndexes([
        { key: { ownerId: 1, updatedAt: -1 }, name: "owner_updatedAt" },
        { key: { ownerId: 1, status: 1 }, name: "owner_status" },
        {
          key: { ownerId: 1, email: 1 },
          name: "owner_email_unique",
          unique: true,
          partialFilterExpression: { email: { $type: "string" } },
        },
        {
          key: { ownerId: 1, firstName: "text", lastName: "text", company: "text", email: "text" },
          name: "owner_customer_search",
        },
      ])
      .then(() => undefined);
  }

  return indexesPromise;
}

export function toCustomerResponse(customer: CustomerDocument) {
  return {
    id: customer._id?.toString(),
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email ?? null,
    phone: customer.phone ?? null,
    company: customer.company ?? null,
    address: customer.address ?? null,
    city: customer.city ?? null,
    country: customer.country ?? null,
    status: customer.status,
    notes: customer.notes ?? null,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}