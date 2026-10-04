import type { Collection } from "mongodb";
import { db } from "@/lib/db";

export const stripeEventStatuses = ["processing", "processed", "ignored", "failed"] as const;
export type StripeEventStatus = (typeof stripeEventStatuses)[number];

export interface StripeEventDocument {
  _id?: string;
  eventId: string;
  type: string;
  status: StripeEventStatus;
  paymentId?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
  processedAt?: Date;
}

let indexesPromise: Promise<void> | null = null;

export function getStripeEventsCollection(): Collection<StripeEventDocument> {
  return db.collection<StripeEventDocument>("stripe-events");
}

export async function ensureStripeEventIndexes() {
  if (!indexesPromise) {
    indexesPromise = getStripeEventsCollection()
      .createIndexes([{ key: { eventId: 1 }, name: "eventId_unique", unique: true }])
      .then(() => undefined);
  }

  return indexesPromise;
}
