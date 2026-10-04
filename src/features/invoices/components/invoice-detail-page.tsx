"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Banknote,
  Download,
  Loader2,
  Mail,
  Printer,
  RefreshCw,
  ShoppingCart,
  X,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type InvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "overdue" | "cancelled";

type PaymentMethod = "cash" | "bank_transfer" | "card" | "mobile_banking" | "other";

type InvoiceItem = {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

type PaymentRecord = {
  id: string;
  invoiceId: string;
  orderId: string;
  customerId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  reference: string | null;
  paymentDate: string;
  notes: string | null;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type InvoiceDetail = {
  id: string;
  invoiceNumber: string;
  orderId: string;
  customerId: string;
  customerSnapshot: {
    name: string;
    email: string | null;
    phone: string | null;
  };
  items: InvoiceItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paidAmount: number;
  outstandingAmount: number;
  issueDate: string;
  dueDate: string | null;
  status: InvoiceStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  payments: PaymentRecord[];
};

type PaymentForm = {
  amount: string;
  paymentMethod: PaymentMethod;
  reference: string;
  notes: string;
  paymentDate: string;
};

type PaymentFormErrors = Partial<Record<keyof PaymentForm | "form", string>>;

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "bank_transfer", "card", "mobile_banking", "other"];

const emptyPaymentForm = (outstanding: number): PaymentForm => ({
  amount: outstanding > 0 ? String(outstanding) : "",
  paymentMethod: "cash",
  reference: "",
  notes: "",
  paymentDate: "",
});

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatStatusLabel(status: InvoiceStatus) {
  return status.replace(/_/g, " ");
}

function formatPaymentMethod(method: PaymentMethod) {
  return method.replace(/_/g, " ");
}

function getStatusTone(status: InvoiceStatus) {
  switch (status) {
    case "paid":
      return "positive" as const;
    case "partially_paid":
    case "issued":
      return "accent" as const;
    case "overdue":
      return "warning" as const;
    default:
      return "neutral" as const;
  }
}

function canCancelInvoice(invoice: InvoiceDetail) {
  return (
    invoice.status !== "cancelled" &&
    invoice.status !== "paid" &&
    invoice.status !== "partially_paid" &&
    invoice.paidAmount === 0
  );
}

function canRecordPayment(invoice: InvoiceDetail) {
  return invoice.status !== "cancelled" && invoice.outstandingAmount > 0;
}

export function InvoiceDetailPage({ invoiceId, readOnlyDemo }: { invoiceId: string; readOnlyDemo: boolean }) {
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [emailingInvoice, setEmailingInvoice] = useState(false);
  const [voidingPaymentId, setVoidingPaymentId] = useState<string | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState<PaymentForm>(emptyPaymentForm(0));
  const [paymentErrors, setPaymentErrors] = useState<PaymentFormErrors>({});
  const [paymentSaving, setPaymentSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadInvoice() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(`/api/invoices/${invoiceId}`, {
          signal: controller.signal,
          credentials: "include",
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load invoice.");

        setInvoice(payload.data as InvoiceDetail);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load invoice.");
        setInvoice(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadInvoice();
    return () => controller.abort();
  }, [invoiceId, refreshTick]);

  function openPaymentModal() {
    if (!invoice) return;
    setPaymentForm(emptyPaymentForm(invoice.outstandingAmount));
    setPaymentErrors({});
    setPaymentModalOpen(true);
  }

  function closePaymentModal() {
    setPaymentModalOpen(false);
    setPaymentForm(emptyPaymentForm(0));
    setPaymentErrors({});
  }

  function validatePaymentForm(outstanding: number) {
    const nextErrors: PaymentFormErrors = {};
    const amount = Number(paymentForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      nextErrors.amount = "Enter a valid amount greater than 0.";
    } else if (amount > outstanding) {
      nextErrors.amount = `Amount cannot exceed ${formatMoney(outstanding)} outstanding.`;
    }
    setPaymentErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function submitPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice) return;
    if (!validatePaymentForm(invoice.outstandingAmount)) return;

    setPaymentSaving(true);
    setPaymentErrors({});

    const body: Record<string, unknown> = {
      invoiceId: invoice.id,
      amount: Number(paymentForm.amount),
      paymentMethod: paymentForm.paymentMethod,
    };
    if (paymentForm.reference.trim()) body.reference = paymentForm.reference.trim();
    if (paymentForm.notes.trim()) body.notes = paymentForm.notes.trim();
    if (paymentForm.paymentDate) body.paymentDate = paymentForm.paymentDate;

    try {
      const response = await fetch("/api/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to record payment.");

      setFeedback("Payment recorded successfully.");
      closePaymentModal();
      setRefreshTick((current) => current + 1);
    } catch (saveError) {
      setPaymentErrors({
        form: saveError instanceof Error ? saveError.message : "Unable to record payment.",
      });
    } finally {
      setPaymentSaving(false);
    }
  }

  async function downloadPdf() {
    if (!invoice || downloadingPdf) return;

    setDownloadingPdf(true);
    setError("");

    try {
      const response = await fetch(`/api/invoices/${invoice.id}/pdf`, {
        credentials: "include",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "Unable to download invoice PDF.");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/i);
      const filename = filenameMatch?.[1] || `invoice-${invoice.invoiceNumber}.pdf`;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Unable to download invoice PDF.");
    } finally {
      setDownloadingPdf(false);
    }
  }

  async function emailInvoice() {
    if (!invoice || emailingInvoice) return;

    const recipient = invoice.customerSnapshot.email?.trim();
    if (!recipient) {
      setError("Add a customer email address before emailing this invoice.");
      return;
    }

    if (!window.confirm(`Send invoice ${invoice.invoiceNumber} to ${recipient}?`)) return;

    setEmailingInvoice(true);
    setError("");
    setFeedback("");

    try {
      const response = await fetch(`/api/invoices/${invoice.id}/email`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string; data?: { to?: string } } | null;
      if (!response.ok) throw new Error(payload?.error || "Unable to email invoice.");

      setFeedback(`Invoice emailed to ${payload?.data?.to || recipient}.`);
    } catch (emailError) {
      setError(emailError instanceof Error ? emailError.message : "Unable to email invoice.");
    } finally {
      setEmailingInvoice(false);
    }
  }

  async function cancelInvoice() {
    if (!invoice) return;
    if (!window.confirm(`Cancel invoice ${invoice.invoiceNumber}? This cannot be undone.`)) return;

    setCancelling(true);
    setFeedback("");

    try {
      const response = await fetch(`/api/invoices/${invoice.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to cancel invoice.");

      setFeedback(`Invoice ${invoice.invoiceNumber} cancelled.`);
      setRefreshTick((current) => current + 1);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Unable to cancel invoice.");
    } finally {
      setCancelling(false);
    }
  }

  async function voidPayment(payment: PaymentRecord) {
    if (!invoice) return;
    if (payment.voidedAt) return;
    if (!window.confirm(`Void payment of ${formatMoney(payment.amount)}?`)) return;

    setVoidingPaymentId(payment.id);
    setFeedback("");

    try {
      const response = await fetch(`/api/payments/${payment.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to void payment.");

      setFeedback("Payment voided successfully.");
      setRefreshTick((current) => current + 1);
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : "Unable to void payment.");
    } finally {
      setVoidingPaymentId(null);
    }
  }

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
      <div className="mb-6 flex flex-col gap-4 print:hidden sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/invoices"
            className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
          >
            <ArrowLeft className="size-4" aria-hidden="true" /> Back to invoices
          </Link>
          {invoice ? (
            <Link
              href="/orders"
              className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
            >
              <ShoppingCart className="size-4" aria-hidden="true" /> Orders
            </Link>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {readOnlyDemo ? <Badge tone="accent">Read-only demo</Badge> : null}
          <Button type="button" variant="secondary" className="h-9" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden="true" /> Print
          </Button>
          {invoice ? (
            <Button type="button" variant="secondary" className="h-9" onClick={() => void downloadPdf()} disabled={downloadingPdf}>
              {downloadingPdf ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
              {downloadingPdf ? "Downloading..." : "Download PDF"}
            </Button>
          ) : null}
          {invoice ? (
            <Button
              type="button"
              variant="secondary"
              className="h-9"
              onClick={() => void emailInvoice()}
              disabled={emailingInvoice || !invoice.customerSnapshot.email || readOnlyDemo}
              title={
                readOnlyDemo
                  ? "Email sending is disabled for the demo account."
                  : !invoice.customerSnapshot.email
                    ? "Customer email is required to send this invoice."
                    : "Email invoice PDF to customer"
              }
            >
              {emailingInvoice ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Mail className="size-4" aria-hidden="true" />}
              {emailingInvoice ? "Sending..." : "Email Invoice"}
            </Button>
          ) : null}
          {!readOnlyDemo && invoice && canRecordPayment(invoice) ? (
            <Button type="button" variant="primary" className="h-9" onClick={openPaymentModal}>
              <Banknote className="size-4" aria-hidden="true" /> Record payment
            </Button>
          ) : null}
          {!readOnlyDemo && invoice && canCancelInvoice(invoice) ? (
            <Button type="button" variant="secondary" className="h-9 text-red-600" onClick={() => void cancelInvoice()} disabled={cancelling}>
              {cancelling ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <XCircle className="size-4" aria-hidden="true" />}
              Cancel invoice
            </Button>
          ) : null}
        </div>
      </div>

      {feedback ? (
        <div className="mb-5 rounded-xl border border-[var(--positive)]/20 bg-[var(--positive-soft)] px-4 py-3 text-sm font-medium text-[var(--positive)] print:hidden" role="status">
          {feedback}
        </div>
      ) : null}

      {error ? (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 print:hidden">
          <span>{error}</span>
          <Button type="button" variant="ghost" className="h-8 px-2 text-red-700" onClick={() => setRefreshTick((current) => current + 1)}>
            <RefreshCw className="size-4" aria-hidden="true" /> Retry
          </Button>
        </div>
      ) : null}

      {loading ? (
        <Card>
          <div className="space-y-3 p-6" aria-label="Loading invoice" aria-busy="true">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="h-12 animate-pulse rounded-xl bg-[var(--surface-soft)]" />
            ))}
          </div>
        </Card>
      ) : !invoice ? (
        <Card>
          <div className="px-6 py-16 text-center">
            <h2 className="text-lg font-semibold">Invoice not found</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">This invoice may have been removed or you may not have access.</p>
            <Link
              href="/invoices"
              className="mt-5 inline-flex h-10 items-center rounded-xl border border-[var(--line-strong)] bg-[var(--surface-raised)] px-4 text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--surface-soft)]"
            >
              Return to invoices
            </Link>
          </div>
        </Card>
      ) : (
        <div className="print:block">
          <Card padding="none" className="overflow-hidden">
            <div className="border-b border-[var(--line)] p-5 sm:p-8">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-bold tracking-[0.18em] text-[var(--accent)] uppercase">Invoice</p>
                  <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em]">{invoice.invoiceNumber}</h1>
                  <p className="mt-2 text-sm text-[var(--muted)]">Issued {formatDate(invoice.issueDate)}</p>
                  {invoice.dueDate ? <p className="text-sm text-[var(--muted)]">Due {formatDate(invoice.dueDate)}</p> : null}
                </div>
                <Badge tone={getStatusTone(invoice.status)} className="self-start capitalize">
                  {formatStatusLabel(invoice.status)}
                </Badge>
              </div>

              <div className="mt-8 grid gap-6 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">Bill to</p>
                  <p className="mt-2 font-semibold">{invoice.customerSnapshot.name}</p>
                  {invoice.customerSnapshot.email ? <p className="text-sm text-[var(--muted)]">{invoice.customerSnapshot.email}</p> : null}
                  {invoice.customerSnapshot.phone ? <p className="text-sm text-[var(--muted)]">{invoice.customerSnapshot.phone}</p> : null}
                </div>
                <div>
                  <p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">Related order</p>
                  <Link href="/orders" className="mt-2 inline-flex text-sm font-medium text-[var(--accent-strong)] hover:underline print:hidden">
                    View orders
                  </Link>
                  <p className="mt-1 font-mono text-sm text-[var(--muted)] print:block">Order #{invoice.orderId.slice(-6)}</p>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead className="border-b border-[var(--line)] bg-[var(--surface-soft)] text-[11px] font-bold tracking-[0.12em] text-[var(--muted)] uppercase">
                  <tr>
                    <th className="px-5 py-3 font-semibold sm:px-8">Item</th>
                    <th className="px-5 py-3 font-semibold">Qty</th>
                    <th className="px-5 py-3 font-semibold">Unit price</th>
                    <th className="px-5 py-3 font-semibold sm:pr-8">Line total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {invoice.items.map((item, index) => (
                    <tr key={`${item.productId}-${index}`} className="text-sm">
                      <td className="px-5 py-4 font-medium sm:px-8">{item.productName}</td>
                      <td className="px-5 py-4 text-[var(--muted)]">{item.quantity}</td>
                      <td className="px-5 py-4 text-[var(--muted)]">{formatMoney(item.unitPrice)}</td>
                      <td className="px-5 py-4 font-medium sm:pr-8">{formatMoney(item.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-6 border-t border-[var(--line)] p-5 sm:grid-cols-2 sm:p-8">
              <div>
                {invoice.notes ? (
                  <>
                    <p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">Notes</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--ink)]">{invoice.notes}</p>
                  </>
                ) : null}
              </div>

              <div className="space-y-2 text-sm sm:ml-auto sm:max-w-xs">
                <div className="flex justify-between gap-4">
                  <span className="text-[var(--muted)]">Subtotal</span>
                  <span className="font-medium">{formatMoney(invoice.subtotal)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-[var(--muted)]">Discount</span>
                  <span className="font-medium">{formatMoney(invoice.discount)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-[var(--muted)]">Tax</span>
                  <span className="font-medium">{formatMoney(invoice.tax)}</span>
                </div>
                <div className="flex justify-between gap-4 border-t border-[var(--line)] pt-2 text-base">
                  <span className="font-semibold">Total</span>
                  <span className="font-semibold">{formatMoney(invoice.total)}</span>
                </div>
              </div>
            </div>
          </Card>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="text-lg font-semibold">Payment summary</h2>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-[var(--muted)]">Paid</span>
                  <span className="font-semibold text-[var(--positive)]">{formatMoney(invoice.paidAmount)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-[var(--muted)]">Outstanding</span>
                  <span className="font-semibold">{formatMoney(invoice.outstandingAmount)}</span>
                </div>
              </div>
            </Card>

            <Card padding="none">
              <div className="border-b border-[var(--line)] p-5">
                <h2 className="text-lg font-semibold">Payment history</h2>
              </div>
              {invoice.payments.length === 0 ? (
                <p className="p-5 text-sm text-[var(--muted)]">No payments recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="border-b border-[var(--line)] bg-[var(--surface-soft)] text-[11px] font-bold tracking-[0.12em] text-[var(--muted)] uppercase">
                      <tr>
                        <th className="px-5 py-3 font-semibold">Date</th>
                        <th className="px-5 py-3 font-semibold">Amount</th>
                        <th className="px-5 py-3 font-semibold">Method</th>
                        <th className="px-5 py-3 font-semibold">Reference</th>
                        <th className="px-5 py-3 font-semibold">Notes</th>
                        <th className="px-5 py-3 font-semibold"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--line)]">
                      {invoice.payments.map((payment) => (
                        <tr key={payment.id} className={payment.voidedAt ? "opacity-60" : undefined}>
                          <td className="px-5 py-4 text-[var(--muted)]">{formatDateTime(payment.paymentDate)}</td>
                          <td className="px-5 py-4 font-medium">{formatMoney(payment.amount)}</td>
                          <td className="px-5 py-4 capitalize text-[var(--muted)]">{formatPaymentMethod(payment.paymentMethod)}</td>
                          <td className="px-5 py-4 text-[var(--muted)]">{payment.reference || "—"}</td>
                          <td className="max-w-[200px] truncate px-5 py-4 text-[var(--muted)]" title={payment.notes ?? undefined}>
                            {payment.notes || "—"}
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-2">
                              {payment.voidedAt ? <Badge tone="neutral">Voided</Badge> : null}
                              {!readOnlyDemo && !payment.voidedAt && invoice.status !== "cancelled" ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="h-8 px-2 text-xs text-red-600"
                                  onClick={() => void voidPayment(payment)}
                                  disabled={voidingPaymentId === payment.id}
                                >
                                  {voidingPaymentId === payment.id ? (
                                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                                  ) : (
                                    "Void"
                                  )}
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {paymentModalOpen && invoice ? (
        <RecordPaymentModal
          invoice={invoice}
          form={paymentForm}
          errors={paymentErrors}
          saving={paymentSaving}
          onChange={(field, value) => {
            setPaymentForm((current) => ({ ...current, [field]: value }));
            setPaymentErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
          }}
          onClose={closePaymentModal}
          onSubmit={submitPayment}
        />
      ) : null}
    </main>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--ink)]/40 p-4 sm:items-center print:hidden" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close dialog" onClick={onClose} />
      <div className="relative z-10 my-auto max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-[var(--line)] bg-[var(--surface-raised)] px-5 py-4 sm:px-6">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button type="button" variant="icon" className="size-8" aria-label="Close dialog" onClick={onClose}>
            <X className="size-5" aria-hidden="true" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RecordPaymentModal({
  invoice,
  form,
  errors,
  saving,
  onChange,
  onClose,
  onSubmit,
}: {
  invoice: InvoiceDetail;
  form: PaymentForm;
  errors: PaymentFormErrors;
  saving: boolean;
  onChange: (field: keyof PaymentForm, value: string) => void;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Modal title="Record payment" onClose={onClose}>
      <form onSubmit={onSubmit} className="p-5 sm:p-6">
        <p className="text-sm text-[var(--muted)]">
          Invoice <span className="font-semibold text-[var(--ink)]">{invoice.invoiceNumber}</span> · Outstanding{" "}
          <span className="font-semibold text-[var(--ink)]">{formatMoney(invoice.outstandingAmount)}</span>
        </p>

        <div className="mt-5 space-y-4">
          <div className="space-y-2">
            <label htmlFor="detail-payment-amount" className="text-sm font-medium">
              Amount
            </label>
            <Input
              id="detail-payment-amount"
              type="number"
              min={0.01}
              step="0.01"
              max={invoice.outstandingAmount}
              value={form.amount}
              onChange={(event) => onChange("amount", event.target.value)}
              aria-invalid={Boolean(errors.amount)}
            />
            {errors.amount ? <p className="text-xs text-red-600">{errors.amount}</p> : null}
          </div>

          <div className="space-y-2">
            <label htmlFor="detail-payment-method" className="text-sm font-medium">
              Payment method
            </label>
            <select
              id="detail-payment-method"
              value={form.paymentMethod}
              onChange={(event) => onChange("paymentMethod", event.target.value)}
              className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 text-sm capitalize text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]"
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method} className="capitalize">
                  {formatPaymentMethod(method)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="detail-payment-reference" className="text-sm font-medium">
              Reference
            </label>
            <Input
              id="detail-payment-reference"
              value={form.reference}
              onChange={(event) => onChange("reference", event.target.value)}
              placeholder="Transaction or check number"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="detail-payment-date" className="text-sm font-medium">
              Payment date
            </label>
            <Input id="detail-payment-date" type="date" value={form.paymentDate} onChange={(event) => onChange("paymentDate", event.target.value)} />
          </div>

          <div className="space-y-2">
            <label htmlFor="detail-payment-notes" className="text-sm font-medium">
              Notes
            </label>
            <textarea
              id="detail-payment-notes"
              value={form.notes}
              onChange={(event) => onChange("notes", event.target.value)}
              rows={3}
              placeholder="Optional payment notes..."
              className="w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 py-2 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]"
            />
          </div>
        </div>

        {errors.form ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {errors.form}
          </p>
        ) : null}

        <div className="mt-7 flex justify-end gap-3 border-t border-[var(--line)] pt-5">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Saving...
              </>
            ) : (
              "Record payment"
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
