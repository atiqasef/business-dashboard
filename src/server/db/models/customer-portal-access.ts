import { ObjectId, type Collection } from "mongodb";
import { db } from "@/lib/db";
import type { PublicLinkState, PublicLinkStatus } from "@/server/db/models/invoice-access";

/**
 * Separate from invoice-access: a portal token grants customer-scoped invoice history
 * for one ownerId + customerId pair. Invoice-only tokens must never broaden to this.
 */
export interface CustomerPortalAccessDocument {
  _id?: ObjectId;
  ownerId: string;
  customerId: ObjectId;
  /** Invoice used when the portal link was created (audit/context only). */
  sourceInvoiceId: ObjectId;
  nonce: string;
  tokenHash: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  lastAccessedAt?: Date;
}

let indexesPromise: Promise<void> | null = null;

export function getCustomerPortalAccessCollection(): Collection<CustomerPortalAccessDocument> {
  return db.collection<CustomerPortalAccessDocument>("customer-portal-access");
}

export async function ensureCustomerPortalAccessIndexes() {
  if (!indexesPromise) {
    indexesPromise = getCustomerPortalAccessCollection()
      .createIndexes([
        { key: { tokenHash: 1 }, name: "tokenHash_unique", unique: true },
        { key: { ownerId: 1, customerId: 1, createdAt: -1 }, name: "owner_customer_createdAt" },
        { key: { expiresAt: 1 }, name: "expiresAt" },
      ])
      .then(() => undefined);
  }

  return indexesPromise;
}

export function toPortalLinkState(
  access: CustomerPortalAccessDocument | null,
  options?: { url?: string; now?: Date },
): PublicLinkState {
  if (!access) {
    return {
      status: "none",
      expiresAt: null,
      createdAt: null,
      revokedAt: null,
    };
  }

  const now = options?.now ?? new Date();
  let status: PublicLinkStatus = "active";
  if (access.revokedAt) status = "revoked";
  else if (access.expiresAt.getTime() <= now.getTime()) status = "expired";

  return {
    status,
    expiresAt: access.expiresAt.toISOString(),
    createdAt: access.createdAt.toISOString(),
    revokedAt: access.revokedAt ? access.revokedAt.toISOString() : null,
    ...(options?.url && status === "active" ? { url: options.url } : {}),
  };
}
