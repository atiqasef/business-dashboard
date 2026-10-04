"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Banknote,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Loader2,
  RefreshCw,
  X,
  XCircle,
} from "lucide-react";
import { BackToDashboardLink } from "@/components/common/back-to-dashboard-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type InvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "overdue" | "cancelled";

type PaymentMethod = "cash" | "bank_transfer" | "card" | "mobile_banking" | "other";

type InvoiceListItem = {
  id: string;
  invoiceNumber: string;
  orderId: string;
  customerId: string;
  customerSnapshot: {
    name: string;
    email: string | null;
    phone: string | null;
  };
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
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type PaymentForm = {
  amount: string;
  paymentMethod: PaymentMethod;
  reference: string;
  notes: string;
  paymentDate: string;
};

type PaymentFormErrors = Partial<Record<keyof PaymentForm | "form", string>>;

const INVOICE_STATUSES: Array<"all" | InvoiceStatus> = [
  "all",
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "overdue",
  "cancelled",
];

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

function canCancelInvoice(invoice: InvoiceListItem) {
  return (
    invoice.status !== "cancelled" &&
    invoice.status !== "paid" &&
    invoice.status !== "partially_paid" &&
    invoice.paidAmount === 0
  );
}

function canRecordPayment(invoice: InvoiceListItem) {
  return invoice.status !== "cancelled" && invoice.outstandingAmount > 0;
}

export function InvoicesPage({ readOnlyDemo }: { readOnlyDemo: boolean }) {
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | InvoiceStatus>("all");
  const [page, setPage] = useState(1);
  const [refreshTick, setRefreshTick] = useState(0);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 10, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<InvoiceListItem | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentForm>(emptyPaymentForm(0));
  const [paymentErrors, setPaymentErrors] = useState<PaymentFormErrors>({});
  const [paymentSaving, setPaymentSaving] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [searchDraft]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadInvoices() {
      setLoading(true);
      setError("");

      try {
        const params = new URLSearchParams({ page: String(page), pageSize: "10" });
        if (search) params.set("search", search);
        if (status !== "all") params.set("status", status);

        const response = await fetch(`/api/invoices?${params.toString()}`, {
          signal: controller.signal,
          credentials: "include",
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load invoices.");

        setInvoices(payload.data);
        setPagination(payload.pagination);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load invoices.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadInvoices();
    return () => controller.abort();
  }, [page, search, status, refreshTick]);

  function openPaymentModal(invoice: InvoiceListItem) {
    setPaymentInvoice(invoice);
    setPaymentForm(emptyPaymentForm(invoice.outstandingAmount));
    setPaymentErrors({});
  }

  function closePaymentModal() {
    setPaymentInvoice(null);
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
    if (!paymentInvoice) return;
    if (!validatePaymentForm(paymentInvoice.outstandingAmount)) return;

    setPaymentSaving(true);
    setPaymentErrors({});

    const body: Record<string, unknown> = {
      invoiceId: paymentInvoice.id,
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

  async function cancelInvoice(invoice: InvoiceListItem) {
    if (!window.confirm(`Cancel invoice ${invoice.invoiceNumber}? This cannot be undone.`)) return;

    setCancellingId(invoice.id);
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
      setCancellingId(null);
    }
  }

  const pageStart = (pagination.page - 1) * pagination.pageSize + 1;
  const pageEnd = Math.min(pagination.page * pagination.pageSize, pagination.total);

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-xs font-bold tracking-[0.18em] text-[var(--accent)] uppercase">Workspace / Invoices</p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Invoices</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Track billing, payments, and outstanding balances across your customers.</p>
        </div>

        <div className="flex flex-col gap-3 self-start sm:self-auto sm:flex-row sm:items-center">
          <BackToDashboardLink />
          {readOnlyDemo ? <Badge tone="accent">Read-only demo</Badge> : null}
        </div>
      </div>

      {feedback ? (
        <div className="mb-5 rounded-xl border border-[var(--positive)]/20 bg-[var(--positive-soft)] px-4 py-3 text-sm font-medium text-[var(--positive)]" role="status">
          {feedback}
        </div>
      ) : null}

      <Card padding="none">
        <div className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm text-[var(--muted)]">Total invoices</p>
            <p className="mt-1 text-2xl font-semibold tracking-[-0.03em]">{pagination.total}</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              aria-label="Search invoices"
              placeholder="Search invoices..."
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              className="h-10 min-w-0 sm:w-64"
            />
            <label className="flex h-10 items-center rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 text-sm text-[var(--muted)]">
              <span className="sr-only">Filter by status</span>
              <select
                aria-label="Filter invoices by status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as "all" | InvoiceStatus);
                  setPage(1);
                }}
                className="bg-transparent pr-5 text-sm font-medium capitalize text-[var(--ink)] outline-none"
              >
                {INVOICE_STATUSES.map((value) => (
                  <option key={value} value={value} className="capitalize">
                    {value === "all" ? "All statuses" : formatStatusLabel(value)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {error ? (
          <div className="mx-5 mb-5 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:mx-6">
            <span>{error}</span>
            <Button type="button" variant="ghost" className="h-8 px-2 text-red-700" onClick={() => setRefreshTick((current) => current + 1)}>
              <RefreshCw className="size-4" aria-hidden="true" /> Retry
            </Button>
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-3 p-5 sm:p-6" aria-label="Loading invoices" aria-busy="true">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="h-14 animate-pulse rounded-xl bg-[var(--surface-soft)]" />
            ))}
          </div>
        ) : invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
              <FileText className="size-7" aria-hidden="true" />
            </span>
            <h2 className="mt-5 text-lg font-semibold">{search || status !== "all" ? "No invoices match these filters" : "No invoices yet"}</h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">
              {search || status !== "all"
                ? "Try another search or clear the status filter."
                : "Invoices created from orders will appear here for payment tracking."}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[1100px] text-left">
                <thead className="border-y border-[var(--line)] bg-[var(--surface-soft)] text-[11px] font-bold tracking-[0.12em] text-[var(--muted)] uppercase">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Invoice</th>
                    <th className="px-5 py-3 font-semibold">Customer</th>
                    <th className="px-5 py-3 font-semibold">Issue date</th>
                    <th className="px-5 py-3 font-semibold">Due date</th>
                    <th className="px-5 py-3 font-semibold">Total</th>
                    <th className="px-5 py-3 font-semibold">Paid</th>
                    <th className="px-5 py-3 font-semibold">Outstanding</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {invoices.map((invoice) => (
                    <InvoiceRow
                      key={invoice.id}
                      invoice={invoice}
                      readOnlyDemo={readOnlyDemo}
                      cancelling={cancellingId === invoice.id}
                      onCancel={() => void cancelInvoice(invoice)}
                      onRecordPayment={() => openPaymentModal(invoice)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-[var(--line)] lg:hidden">
              {invoices.map((invoice) => (
                <InvoiceMobileCard
                  key={invoice.id}
                  invoice={invoice}
                  readOnlyDemo={readOnlyDemo}
                  cancelling={cancellingId === invoice.id}
                  onCancel={() => void cancelInvoice(invoice)}
                  onRecordPayment={() => openPaymentModal(invoice)}
                />
              ))}
            </div>

            <div className="flex flex-col gap-3 border-t border-[var(--line)] p-4 text-sm text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
              <p>
                Showing {pageStart}-{pageEnd} of {pagination.total}
              </p>
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" className="h-9 px-3" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
                  <ChevronLeft className="size-4" aria-hidden="true" /> Previous
                </Button>
                <span className="px-2 text-xs font-semibold text-[var(--ink)]">
                  Page {page} of {Math.max(pagination.totalPages, 1)}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-9 px-3"
                  disabled={page >= pagination.totalPages || pagination.totalPages === 0}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next <ChevronRight className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {paymentInvoice ? (
        <RecordPaymentModal
          invoice={paymentInvoice}
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

function InvoiceRow({
  invoice,
  readOnlyDemo,
  cancelling,
  onCancel,
  onRecordPayment,
}: {
  invoice: InvoiceListItem;
  readOnlyDemo: boolean;
  cancelling: boolean;
  onCancel: () => void;
  onRecordPayment: () => void;
}) {
  return (
    <tr className="text-sm">
      <td className="px-5 py-4">
        <Link href={`/invoices/${invoice.id}`} className="font-semibold hover:text-[var(--accent-strong)]">
          {invoice.invoiceNumber}
        </Link>
      </td>
      <td className="px-5 py-4">
        <div>
          <p className="font-medium">{invoice.customerSnapshot.name}</p>
          {invoice.customerSnapshot.email ? <p className="text-xs text-[var(--muted)]">{invoice.customerSnapshot.email}</p> : null}
        </div>
      </td>
      <td className="px-5 py-4 text-[var(--muted)]">{formatDate(invoice.issueDate)}</td>
      <td className="px-5 py-4 text-[var(--muted)]">{formatDate(invoice.dueDate)}</td>
      <td className="px-5 py-4 font-medium">{formatMoney(invoice.total)}</td>
      <td className="px-5 py-4 text-[var(--muted)]">{formatMoney(invoice.paidAmount)}</td>
      <td className="px-5 py-4 font-medium">{formatMoney(invoice.outstandingAmount)}</td>
      <td className="px-5 py-4">
        <Badge tone={getStatusTone(invoice.status)} className="capitalize">
          {formatStatusLabel(invoice.status)}
        </Badge>
      </td>
      <td className="px-5 py-4">
        <InvoiceActions
          invoice={invoice}
          readOnlyDemo={readOnlyDemo}
          cancelling={cancelling}
          onCancel={onCancel}
          onRecordPayment={onRecordPayment}
        />
      </td>
    </tr>
  );
}

function InvoiceMobileCard({
  invoice,
  readOnlyDemo,
  cancelling,
  onCancel,
  onRecordPayment,
}: {
  invoice: InvoiceListItem;
  readOnlyDemo: boolean;
  cancelling: boolean;
  onCancel: () => void;
  onRecordPayment: () => void;
}) {
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/invoices/${invoice.id}`} className="font-semibold hover:text-[var(--accent-strong)]">
            {invoice.invoiceNumber}
          </Link>
          <p className="mt-1 truncate text-xs text-[var(--muted)]">{invoice.customerSnapshot.name}</p>
        </div>
        <Badge tone={getStatusTone(invoice.status)} className="capitalize shrink-0">
          {formatStatusLabel(invoice.status)}
        </Badge>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-[var(--muted)]">Total</p>
          <p className="mt-1 font-medium">{formatMoney(invoice.total)}</p>
        </div>
        <div>
          <p className="text-[var(--muted)]">Outstanding</p>
          <p className="mt-1 font-medium">{formatMoney(invoice.outstandingAmount)}</p>
        </div>
        <div>
          <p className="text-[var(--muted)]">Issue date</p>
          <p className="mt-1 font-medium">{formatDate(invoice.issueDate)}</p>
        </div>
        <div>
          <p className="text-[var(--muted)]">Due date</p>
          <p className="mt-1 font-medium">{formatDate(invoice.dueDate)}</p>
        </div>
      </div>

      <div className="mt-4">
        <InvoiceActions
          invoice={invoice}
          readOnlyDemo={readOnlyDemo}
          cancelling={cancelling}
          onCancel={onCancel}
          onRecordPayment={onRecordPayment}
        />
      </div>
    </div>
  );
}

function InvoiceActions({
  invoice,
  readOnlyDemo,
  cancelling,
  onCancel,
  onRecordPayment,
}: {
  invoice: InvoiceListItem;
  readOnlyDemo: boolean;
  cancelling: boolean;
  onCancel: () => void;
  onRecordPayment: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Link
        href={`/invoices/${invoice.id}`}
        aria-label="View invoice"
        className="inline-flex size-8 items-center justify-center rounded-xl text-[var(--muted)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--ink)]"
      >
        <Eye className="size-4" aria-hidden="true" />
      </Link>
      {!readOnlyDemo && canRecordPayment(invoice) ? (
        <Button type="button" variant="icon" className="size-8" aria-label="Record payment" onClick={onRecordPayment}>
          <Banknote className="size-4" aria-hidden="true" />
        </Button>
      ) : null}
      {!readOnlyDemo && canCancelInvoice(invoice) ? (
        <Button
          type="button"
          variant="icon"
          className="size-8 text-red-500 hover:text-red-600"
          aria-label="Cancel invoice"
          onClick={onCancel}
          disabled={cancelling}
        >
          {cancelling ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <XCircle className="size-4" aria-hidden="true" />}
        </Button>
      ) : null}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--ink)]/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
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
  invoice: InvoiceListItem;
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
            <label htmlFor="payment-amount" className="text-sm font-medium">
              Amount
            </label>
            <Input
              id="payment-amount"
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
            <label htmlFor="payment-method" className="text-sm font-medium">
              Payment method
            </label>
            <select
              id="payment-method"
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
            <label htmlFor="payment-reference" className="text-sm font-medium">
              Reference
            </label>
            <Input
              id="payment-reference"
              value={form.reference}
              onChange={(event) => onChange("reference", event.target.value)}
              placeholder="Transaction or check number"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="payment-date" className="text-sm font-medium">
              Payment date
            </label>
            <Input id="payment-date" type="date" value={form.paymentDate} onChange={(event) => onChange("paymentDate", event.target.value)} />
          </div>

          <div className="space-y-2">
            <label htmlFor="payment-notes" className="text-sm font-medium">
              Notes
            </label>
            <textarea
              id="payment-notes"
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
