import { ObjectId, type Collection } from "mongodb";
import { db } from "@/lib/db";

export interface InvoiceAccessDocument {
  _id?: ObjectId;
  ownerId: string;
  invoiceId: ObjectId;
  /**
   * Random nonce used with the server secret to derive the bearer token.
   * This is not the URL token and is never returned to clients.
   */
  nonce: string;
  /** SHA-256 hex digest of the bearer token — used for indexed lookup. */
  tokenHash: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  lastAccessedAt?: Date;
}

export type PublicLinkStatus = "none" | "active" | "expired" | "revoked";

export type PublicLinkState = {
  status: PublicLinkStatus;
  expiresAt: string | null;
  createdAt: string | null;
  revokedAt: string | null;
  /** Present only immediately after create/regenerate. */
  url?: string;
};

let indexesPromise: Promise<void> | null = null;

export function getInvoiceAccessCollection(): Collection<InvoiceAccessDocument> {
  return db.collection<InvoiceAccessDocument>("invoice-access");
}

export async function ensureInvoiceAccessIndexes() {
  if (!indexesPromise) {
    indexesPromise = getInvoiceAccessCollection()
      .createIndexes([
        { key: { tokenHash: 1 }, name: "tokenHash_unique", unique: true },
        { key: { ownerId: 1, invoiceId: 1, createdAt: -1 }, name: "owner_invoice_createdAt" },
        { key: { expiresAt: 1 }, name: "expiresAt" },
      ])
      .then(() => undefined);
  }

  return indexesPromise;
}

export function toPublicLinkState(
  access: InvoiceAccessDocument | null,
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
