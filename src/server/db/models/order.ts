import { ObjectId, type Collection } from "mongodb";
import { db } from "@/lib/db";

export const orderStatuses = ["pending", "confirmed", "completed", "cancelled"] as const;
export type OrderStatus = (typeof orderStatuses)[number];

export interface OrderItem {
  productId: ObjectId;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface OrderDocument {
  _id?: ObjectId;
  ownerId: string;
  customerId: ObjectId;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  total: number;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
}

let indexesPromise: Promise<void> | null = null;

export function getOrdersCollection(): Collection<OrderDocument> {
  return db.collection<OrderDocument>("orders");
}

export async function ensureOrderIndexes() {
  if (!indexesPromise) {
    indexesPromise = getOrdersCollection()
      .createIndexes([
        { key: { ownerId: 1 }, name: "owner_id" },
        { key: { ownerId: 1, createdAt: -1 }, name: "owner_createdAt" },
        { key: { ownerId: 1, status: 1 }, name: "owner_status" },
      ])
      .then(() => undefined);
  }

  return indexesPromise;
}

export function toOrderResponse(order: OrderDocument) {
  return {
    id: order._id?.toString(),
    ownerId: order.ownerId,
    customerId: order.customerId.toString(),
    items: order.items.map((item) => ({
      productId: item.productId.toString(),
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
    subtotal: order.subtotal,
    discount: order.discount,
    total: order.total,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
