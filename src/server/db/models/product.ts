import { ObjectId, type Collection } from "mongodb";
import { db } from "@/lib/db";

export const productStatuses = ["active", "inactive"] as const;
export type ProductStatus = (typeof productStatuses)[number];

export interface ProductDocument {
  _id?: ObjectId;
  ownerId: string;
  name: string;
  description?: string;
  sku: string;
  price: number;
  costPrice?: number;
  stock: number;
  category?: string;
  status: ProductStatus;
  createdAt: Date;
  updatedAt: Date;
}

let indexesPromise: Promise<void> | null = null;

export function getProductsCollection(): Collection<ProductDocument> {
  return db.collection<ProductDocument>("products");
}

export async function ensureProductIndexes() {
  if (!indexesPromise) {
    indexesPromise = getProductsCollection()
      .createIndexes([
        { key: { ownerId: 1, createdAt: -1 }, name: "owner_createdAt" },
        { key: { ownerId: 1, status: 1 }, name: "owner_status" },
        {
          key: { ownerId: 1, sku: 1 },
          name: "owner_sku_unique",
          unique: true,
          partialFilterExpression: { sku: { $type: "string" } },
        },
      ])
      .then(() => undefined);
  }

  return indexesPromise;
}

export function toProductResponse(product: ProductDocument) {
  return {
    id: product._id?.toString(),
    name: product.name,
    description: product.description ?? null,
    sku: product.sku,
    price: product.price,
    costPrice: product.costPrice ?? null,
    stock: product.stock,
    category: product.category ?? null,
    status: product.status,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}
