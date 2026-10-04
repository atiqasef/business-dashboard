import { ObjectId } from "mongodb";
import { POST as createInvoice } from "@/server/api/invoices";
import { POST as createPayment } from "@/server/api/payments";
import { mockSession, type TestUser } from "./auth";
import { jsonRequest, readJson } from "./http";

export async function createInvoiceFromOrder(
  user: TestUser,
  orderId: string,
  body: Record<string, unknown> = {},
) {
  mockSession(user);
  const response = await createInvoice(
    jsonRequest("POST", "http://localhost/api/invoices", {
      orderId,
      tax: 0,
      issue: true,
      ...body,
    }),
  );
  const payload = await readJson(response);
  return { response, payload, data: payload?.data as Record<string, unknown> | undefined };
}

export async function createPaymentForInvoice(
  user: TestUser,
  invoiceId: string,
  amount: number,
  body: Record<string, unknown> = {},
) {
  mockSession(user);
  const response = await createPayment(
    jsonRequest("POST", "http://localhost/api/payments", {
      invoiceId,
      amount,
      paymentMethod: "cash",
      ...body,
    }),
  );
  const payload = await readJson(response);
  return { response, payload, data: payload?.data as Record<string, unknown> | undefined };
}

export function asObjectId(id: string) {
  return new ObjectId(id);
}
