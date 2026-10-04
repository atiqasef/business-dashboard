import type { InvoiceDocument, InvoiceStatus } from "@/server/db/models/invoice";

export function normalizeMoney(value: number) {
  return Number(Number(value).toFixed(2));
}

export function deriveInvoiceStatus(
  invoice: Pick<InvoiceDocument, "status" | "total" | "paidAmount" | "outstandingAmount" | "dueDate">,
  now = new Date(),
): InvoiceStatus {
  if (invoice.status === "cancelled") return "cancelled";
  if (invoice.status === "draft") return "draft";

  const paidAmount = normalizeMoney(invoice.paidAmount);
  const outstandingAmount = normalizeMoney(invoice.outstandingAmount);
  const total = normalizeMoney(invoice.total);

  if (outstandingAmount <= 0 || paidAmount >= total) return "paid";
  if (invoice.dueDate && invoice.dueDate.getTime() < now.getTime() && outstandingAmount > 0) return "overdue";
  if (paidAmount > 0 && outstandingAmount > 0) return "partially_paid";
  return "issued";
}
