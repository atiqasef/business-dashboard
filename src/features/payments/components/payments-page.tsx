"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import {
  Banknote,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  RefreshCw,
  Search,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
type PaymentMethod = "cash" | "bank_transfer" | "card" | "mobile_banking" | "stripe" | "other";
type PaymentDatePreset = "all_time" | "last_7_days" | "last_30_days" | "last_90_days" | "custom";
type PaymentStatus = "active" | "voided";

const MANUAL_PAYMENT_METHODS: PaymentMethod[] = ["cash", "bank_transfer", "card", "mobile_banking", "other"];
const PAYMENT_METHODS: PaymentMethod[] = [...MANUAL_PAYMENT_METHODS, "stripe"];
const PAYMENT_DATE_PRESETS: PaymentDatePreset[] = ["all_time", "last_7_days", "last_30_days", "last_90_days", "custom"];

type PaymentListItem = {
  id: string;
  invoiceId: string;
  orderId: string;
  customerId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  reference: string | null;
  paymentDate: string;
  notes: string | null;
  provider: string | null;
  providerPaymentId: string | null;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  status: PaymentStatus;
  invoiceNumber: string;
  customerName: string;
  customerEmail: string | null;
  invoiceOutstandingAmount: number | null;
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type Summary = {
  totalCollected: number;
  paymentCount: number;
  activePaymentCount: number;
  averagePayment: number;
  outstandingReceivables: number;
};

type PayableInvoice = {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerSnapshot: { name: string; email: string | null };
  outstandingAmount: number;
  status: string;
};

type PaymentForm = {
  invoiceId: string;
  amount: string;
  paymentMethod: PaymentMethod;
  reference: string;
  notes: string;
  paymentDate: string;
};

type PaymentFormErrors = Partial<Record<keyof PaymentForm | "form", string>>;

const DATE_PRESET_LABELS: Record<PaymentDatePreset, string> = {
  all_time: "All time",
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  last_90_days: "Last 90 days",
  custom: "Custom range",
};

const emptyPaymentForm = (): PaymentForm => ({
  invoiceId: "",
  amount: "",
  paymentMethod: "cash",
  reference: "",
  notes: "",
  paymentDate: "",
});

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatPaymentMethod(method: PaymentMethod) {
  if (method === "stripe") return "Stripe";
  return method.replace(/_/g, " ");
}

function shortId(id: string) {
  return id.slice(-8).toUpperCase();
}

export function PaymentsPage({ readOnlyDemo }: { readOnlyDemo: boolean }) {
  const searchParams = useSearchParams();
  const invoiceIdFilter = searchParams.get("invoiceId");

  const [payments, setPayments] = useState<PaymentListItem[]>([]);
  const [summary, setSummary] = useState<Summary>({
    totalCollected: 0,
    paymentCount: 0,
    activePaymentCount: 0,
    averagePayment: 0,
    outstandingReceivables: 0,
  });
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | PaymentStatus>("all");
  const [paymentMethod, setPaymentMethod] = useState<"all" | PaymentMethod>("all");
  const [datePreset, setDatePreset] = useState<PaymentDatePreset>("all_time");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [page, setPage] = useState(1);
  const [refreshTick, setRefreshTick] = useState(0);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  const [selected, setSelected] = useState<PaymentListItem | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState<PaymentForm>(emptyPaymentForm());
  const [paymentErrors, setPaymentErrors] = useState<PaymentFormErrors>({});
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [invoiceQuery, setInvoiceQuery] = useState("");
  const [invoiceResults, setInvoiceResults] = useState<PayableInvoice[]>([]);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<PayableInvoice | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [searchDraft]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPayments() {
      setLoading(true);
      setError("");

      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: "20",
          datePreset,
        });
        if (search) params.set("search", search);
        if (status !== "all") params.set("status", status);
        if (paymentMethod !== "all") params.set("paymentMethod", paymentMethod);
        if (datePreset === "custom") {
          if (customStart) params.set("start", customStart);
          if (customEnd) params.set("end", customEnd);
        }
        if (invoiceIdFilter) params.set("invoiceId", invoiceIdFilter);

        const response = await fetch(`/api/payments?${params.toString()}`, {
          signal: controller.signal,
          credentials: "include",
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load payments.");

        setPayments(payload.data);
        setPagination(payload.pagination);
        setSummary(payload.summary);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load payments.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadPayments();
    return () => controller.abort();
  }, [page, search, status, paymentMethod, datePreset, customStart, customEnd, refreshTick, invoiceIdFilter]);

  useEffect(() => {
    if (!createOpen) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setInvoiceLoading(true);
      try {
        const params = new URLSearchParams({ payable: "1", pageSize: "8", page: "1" });
        if (invoiceQuery.trim()) params.set("search", invoiceQuery.trim());
        const response = await fetch(`/api/invoices?${params.toString()}`, {
          signal: controller.signal,
          credentials: "include",
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load invoices.");
        setInvoiceResults(payload.data as PayableInvoice[]);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setInvoiceResults([]);
      } finally {
        if (!controller.signal.aborted) setInvoiceLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [createOpen, invoiceQuery]);

  function openCreate() {
    setCreateOpen(true);
    setPaymentForm(emptyPaymentForm());
    setPaymentErrors({});
    setSelectedInvoice(null);
    setInvoiceQuery("");
    setInvoiceResults([]);
  }

  function closeCreate() {
    setCreateOpen(false);
    setPaymentForm(emptyPaymentForm());
    setPaymentErrors({});
    setSelectedInvoice(null);
  }

  function selectInvoice(invoice: PayableInvoice) {
    setSelectedInvoice(invoice);
    setPaymentForm((current) => ({
      ...current,
      invoiceId: invoice.id,
      amount: String(invoice.outstandingAmount),
    }));
    setInvoiceQuery(invoice.invoiceNumber);
  }

  function validatePaymentForm(outstanding: number) {
    const nextErrors: PaymentFormErrors = {};
    if (!paymentForm.invoiceId) nextErrors.invoiceId = "Select an invoice.";
    const amount = Number(paymentForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      nextErrors.amount = "Enter a valid amount greater than 0.";
    } else if (amount > outstanding) {
      nextErrors.amount = `Amount cannot exceed ${formatMoney(outstanding)} outstanding.`;
    }
    setPaymentErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function submitPayment(event: FormEvent) {
    event.preventDefault();
    if (readOnlyDemo || paymentSaving) return;
    const outstanding = selectedInvoice?.outstandingAmount ?? 0;
    if (!validatePaymentForm(outstanding)) return;

    setPaymentSaving(true);
    setPaymentErrors({});

    const body: Record<string, unknown> = {
      invoiceId: paymentForm.invoiceId,
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
      closeCreate();
      setRefreshTick((current) => current + 1);
    } catch (saveError) {
      setPaymentErrors({
        form: saveError instanceof Error ? saveError.message : "Unable to record payment.",
      });
    } finally {
      setPaymentSaving(false);
    }
  }

  async function voidPayment(payment: PaymentListItem) {
    if (readOnlyDemo || voidingId) return;
    if (
      !window.confirm(
        `Void payment of ${formatMoney(payment.amount)} for ${payment.invoiceNumber}? This reverses its effect on the invoice balance.`,
      )
    ) {
      return;
    }

    setVoidingId(payment.id);
    setFeedback("");
    try {
      const response = await fetch(`/api/payments/${payment.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to void payment.");
      setFeedback("Payment voided successfully.");
      if (selected?.id === payment.id) setSelected(null);
      setRefreshTick((current) => current + 1);
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : "Unable to void payment.");
    } finally {
      setVoidingId(null);
    }
  }

  const metrics = [
    {
      label: "Total collected",
      value: formatMoney(summary.totalCollected),
      detail: "Active payments in current filters",
    },
    {
      label: "Payment count",
      value: formatNumber(summary.paymentCount),
      detail: `${formatNumber(summary.activePaymentCount)} active in scope`,
    },
    {
      label: "Average payment",
      value: formatMoney(summary.averagePayment),
      detail: "Active payments only",
    },
    {
      label: "Outstanding receivables",
      value: formatMoney(summary.outstandingReceivables),
      detail: "Current balance · not period-limited",
    },
  ];

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-bold tracking-[0.18em] text-[var(--accent)] uppercase">Workspace / Payments</p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Payments</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Track invoice collections, search payment history, and record or void payments against owned invoices.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {readOnlyDemo ? <Badge tone="accent">Read-only demo</Badge> : null}
          <Button type="button" variant="secondary" onClick={() => setRefreshTick((current) => current + 1)}>
            <RefreshCw className="size-4" aria-hidden="true" /> Refresh
          </Button>
          {!readOnlyDemo ? (
            <Button type="button" variant="primary" onClick={openCreate}>
              <Banknote className="size-4" aria-hidden="true" /> Record payment
            </Button>
          ) : null}
        </div>
      </div>

      {feedback ? (
        <p className="mb-4 text-sm font-medium text-[var(--positive)]" aria-live="polite">
          {feedback}
        </p>
      ) : null}
      {error ? (
        <p className="mb-4 text-sm font-medium text-[var(--warning)]" role="alert">
          {error}
        </p>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Payment summary">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <p className="text-xs font-bold tracking-[0.14em] text-[var(--muted)] uppercase">{metric.label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.03em]">{metric.value}</p>
            <p className="mt-2 text-xs text-[var(--muted)]">{metric.detail}</p>
          </Card>
        ))}
      </section>

      <Card className="mt-6" padding="none">
        <div className="flex flex-col gap-3 border-b border-[var(--line)] p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor="payment-search" className="mb-1.5 block text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">
                Search
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
                <Input
                  id="payment-search"
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="Invoice, customer, reference, payment ID…"
                  className="pl-9"
                />
              </div>
            </div>
            <div>
              <label htmlFor="payment-status" className="mb-1.5 block text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">
                Status
              </label>
              <select
                id="payment-status"
                className="h-10 rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 text-sm"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as "all" | PaymentStatus);
                  setPage(1);
                }}
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="voided">Voided</option>
              </select>
            </div>
            <div>
              <label htmlFor="payment-method" className="mb-1.5 block text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">
                Method
              </label>
              <select
                id="payment-method"
                className="h-10 rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 text-sm"
                value={paymentMethod}
                onChange={(event) => {
                  setPaymentMethod(event.target.value as "all" | PaymentMethod);
                  setPage(1);
                }}
              >
                <option value="all">All methods</option>
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {formatPaymentMethod(method)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="payment-date-preset" className="mb-1.5 block text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">
                Date range
              </label>
              <select
                id="payment-date-preset"
                className="h-10 rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 text-sm"
                value={datePreset}
                onChange={(event) => {
                  setDatePreset(event.target.value as PaymentDatePreset);
                  setPage(1);
                }}
              >
                {PAYMENT_DATE_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {DATE_PRESET_LABELS[preset]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {datePreset === "custom" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="payment-start" className="mb-1.5 block text-xs font-medium text-[var(--muted)]">
                  Start
                </label>
                <Input
                  id="payment-start"
                  type="date"
                  value={customStart}
                  onChange={(event) => {
                    setCustomStart(event.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div>
                <label htmlFor="payment-end" className="mb-1.5 block text-xs font-medium text-[var(--muted)]">
                  End
                </label>
                <Input
                  id="payment-end"
                  type="date"
                  value={customEnd}
                  onChange={(event) => {
                    setCustomEnd(event.target.value);
                    setPage(1);
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>

        {loading ? (
          <div className="space-y-3 p-5 sm:p-6" aria-busy="true" aria-label="Loading payments">
            {[1, 2, 3, 4, 5].map((item) => (
              <div key={item} className="h-14 animate-pulse rounded-xl bg-[var(--surface-soft)]" />
            ))}
          </div>
        ) : payments.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
              <Wallet className="size-7" aria-hidden="true" />
            </span>
            <h2 className="mt-5 text-lg font-semibold">
              {search || status !== "all" || paymentMethod !== "all" || datePreset !== "all_time"
                ? "No payments match these filters"
                : "No payments yet"}
            </h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">
              {search || status !== "all" || paymentMethod !== "all" || datePreset !== "all_time"
                ? "Try another search or clear filters."
                : "Record a payment against an issued invoice to start tracking collections."}
            </p>
            {!readOnlyDemo && !search && status === "all" && paymentMethod === "all" && datePreset === "all_time" ? (
              <Button type="button" variant="secondary" className="mt-5" onClick={openCreate}>
                <Banknote className="size-4" aria-hidden="true" /> Record payment
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[960px] text-left">
                <thead className="border-y border-[var(--line)] bg-[var(--surface-soft)] text-[11px] font-bold tracking-[0.12em] text-[var(--muted)] uppercase">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Payment</th>
                    <th className="px-5 py-3 font-semibold">Invoice</th>
                    <th className="px-5 py-3 font-semibold">Customer</th>
                    <th className="px-5 py-3 font-semibold">Amount</th>
                    <th className="px-5 py-3 font-semibold">Date</th>
                    <th className="px-5 py-3 font-semibold">Method</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold">Created</th>
                    <th className="px-5 py-3 font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {payments.map((payment) => (
                    <tr key={payment.id} className="text-sm">
                      <td className="px-5 py-4">
                        <button type="button" className="text-left font-semibold hover:text-[var(--accent-strong)]" onClick={() => setSelected(payment)}>
                          {payment.reference || shortId(payment.id)}
                        </button>
                        <p className="text-xs text-[var(--muted)]">{shortId(payment.id)}</p>
                      </td>
                      <td className="px-5 py-4">
                        <Link href={`/invoices/${payment.invoiceId}`} className="font-medium hover:text-[var(--accent-strong)]">
                          {payment.invoiceNumber}
                        </Link>
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-medium">{payment.customerName}</p>
                        <p className="text-xs text-[var(--muted)]">{payment.customerEmail || "—"}</p>
                      </td>
                      <td className="px-5 py-4 font-medium">{formatMoney(payment.amount)}</td>
                      <td className="px-5 py-4 text-[var(--muted)]">{formatDate(payment.paymentDate)}</td>
                      <td className="px-5 py-4 capitalize text-[var(--muted)]">{formatPaymentMethod(payment.paymentMethod)}</td>
                      <td className="px-5 py-4">
                        <Badge tone={payment.status === "voided" ? "warning" : "positive"}>{payment.status}</Badge>
                      </td>
                      <td className="px-5 py-4 text-[var(--muted)]">{formatDate(payment.createdAt)}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1">
                          <Button type="button" variant="icon" aria-label="View payment" onClick={() => setSelected(payment)}>
                            <Eye className="size-4" aria-hidden="true" />
                          </Button>
                          {!readOnlyDemo && payment.status === "active" ? (
                            <Button
                              type="button"
                              variant="icon"
                              aria-label="Void payment"
                              disabled={voidingId === payment.id}
                              onClick={() => void voidPayment(payment)}
                            >
                              {voidingId === payment.id ? (
                                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                              ) : (
                                <XCircle className="size-4" aria-hidden="true" />
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

            <div className="divide-y divide-[var(--line)] md:hidden">
              {payments.map((payment) => (
                <div key={payment.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <button type="button" className="text-left font-semibold" onClick={() => setSelected(payment)}>
                        {payment.reference || shortId(payment.id)}
                      </button>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {payment.invoiceNumber} · {payment.customerName}
                      </p>
                    </div>
                    <Badge tone={payment.status === "voided" ? "warning" : "positive"}>{payment.status}</Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold">{formatMoney(payment.amount)}</span>
                    <span className="text-[var(--muted)]">{formatDate(payment.paymentDate)}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" className="h-9 flex-1" onClick={() => setSelected(payment)}>
                      View
                    </Button>
                    {!readOnlyDemo && payment.status === "active" ? (
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-9"
                        disabled={voidingId === payment.id}
                        onClick={() => void voidPayment(payment)}
                      >
                        Void
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3 border-t border-[var(--line)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="text-sm text-[var(--muted)]">
                Page {pagination.page} of {Math.max(pagination.totalPages, 1)} · {formatNumber(pagination.total)} payments
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-9"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft className="size-4" aria-hidden="true" /> Previous
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-9"
                  disabled={page >= pagination.totalPages || loading}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next <ChevronRight className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {selected ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="payment-detail-title">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-[var(--line)] bg-[var(--surface-raised)] p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold tracking-[0.14em] text-[var(--muted)] uppercase">Payment details</p>
                <h2 id="payment-detail-title" className="mt-1 text-xl font-semibold tracking-[-0.02em]">
                  {selected.reference || shortId(selected.id)}
                </h2>
              </div>
              <Button type="button" variant="icon" aria-label="Close payment details" onClick={() => setSelected(null)}>
                <X className="size-5" aria-hidden="true" />
              </Button>
            </div>

            <dl className="mt-5 grid gap-3 text-sm">
              {[
                ["Payment ID", selected.id],
                ["Invoice", selected.invoiceNumber],
                ["Customer", selected.customerName],
                ["Email", selected.customerEmail || "—"],
                ["Amount", formatMoney(selected.amount)],
                ["Payment date", formatDate(selected.paymentDate)],
                ["Method", formatPaymentMethod(selected.paymentMethod)],
                ["Status", selected.status],
                ["Reference", selected.reference || selected.providerPaymentId || "—"],
                ["Provider", selected.provider === "stripe" ? "Stripe" : selected.provider || "—"],
                ["Notes", selected.notes || "—"],
                ["Created", formatDateTime(selected.createdAt)],
                [
                  "Invoice outstanding",
                  selected.invoiceOutstandingAmount === null ? "—" : formatMoney(selected.invoiceOutstandingAmount),
                ],
              ].map(([label, value]) => (
                <div key={label} className="grid grid-cols-[140px_1fr] gap-3 border-b border-[var(--line)] pb-3">
                  <dt className="text-[var(--muted)]">{label}</dt>
                  <dd className="font-medium capitalize">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-5 flex flex-wrap gap-2">
              <Link href={`/invoices/${selected.invoiceId}`}>
                <Button type="button" variant="secondary">
                  View invoice
                </Button>
              </Link>
              <Link href={`/customers`}>
                <Button type="button" variant="secondary">
                  Customers
                </Button>
              </Link>
              {!readOnlyDemo && selected.status === "active" ? (
                <Button type="button" variant="primary" disabled={voidingId === selected.id} onClick={() => void voidPayment(selected)}>
                  {voidingId === selected.id ? "Voiding…" : "Void payment"}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="record-payment-title">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-[var(--line)] bg-[var(--surface-raised)] p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold tracking-[0.14em] text-[var(--muted)] uppercase">New payment</p>
                <h2 id="record-payment-title" className="mt-1 text-xl font-semibold tracking-[-0.02em]">
                  Record payment
                </h2>
              </div>
              <Button type="button" variant="icon" aria-label="Close record payment" onClick={closeCreate}>
                <X className="size-5" aria-hidden="true" />
              </Button>
            </div>

            <form className="mt-5 space-y-4" onSubmit={submitPayment} noValidate>
              <div>
                <label htmlFor="invoice-search" className="mb-1.5 block text-sm font-medium">
                  Invoice <span className="text-[var(--accent)]">*</span>
                </label>
                <Input
                  id="invoice-search"
                  value={invoiceQuery}
                  onChange={(event) => {
                    setInvoiceQuery(event.target.value);
                    setSelectedInvoice(null);
                    setPaymentForm((current) => ({ ...current, invoiceId: "" }));
                  }}
                  placeholder="Search payable invoices…"
                  autoComplete="off"
                />
                {paymentErrors.invoiceId ? (
                  <p className="mt-1 text-xs font-medium text-[var(--warning)]">{paymentErrors.invoiceId}</p>
                ) : null}
                <div className="mt-2 max-h-48 overflow-y-auto rounded-2xl border border-[var(--line)]">
                  {invoiceLoading ? (
                    <p className="px-3 py-3 text-sm text-[var(--muted)]">Searching invoices…</p>
                  ) : invoiceResults.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-[var(--muted)]">No payable invoices found.</p>
                  ) : (
                    <ul>
                      {invoiceResults.map((invoice) => (
                        <li key={invoice.id}>
                          <button
                            type="button"
                            className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-[var(--surface-soft)] ${
                              selectedInvoice?.id === invoice.id ? "bg-[var(--surface-soft)]" : ""
                            }`}
                            onClick={() => selectInvoice(invoice)}
                          >
                            <span>
                              <span className="font-semibold">{invoice.invoiceNumber}</span>
                              <span className="mt-0.5 block text-xs text-[var(--muted)]">{invoice.customerSnapshot.name}</span>
                            </span>
                            <span className="font-medium">{formatMoney(invoice.outstandingAmount)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="payment-amount" className="mb-1.5 block text-sm font-medium">
                    Amount <span className="text-[var(--accent)]">*</span>
                  </label>
                  <Input
                    id="payment-amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={paymentForm.amount}
                    onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))}
                    disabled={!selectedInvoice}
                  />
                  {paymentErrors.amount ? (
                    <p className="mt-1 text-xs font-medium text-[var(--warning)]">{paymentErrors.amount}</p>
                  ) : selectedInvoice ? (
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Outstanding {formatMoney(selectedInvoice.outstandingAmount)}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="create-payment-method" className="mb-1.5 block text-sm font-medium">
                    Method
                  </label>
                  <select
                    id="create-payment-method"
                    className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 text-sm"
                    value={paymentForm.paymentMethod}
                    onChange={(event) =>
                      setPaymentForm((current) => ({
                        ...current,
                        paymentMethod: event.target.value as PaymentMethod,
                      }))
                    }
                  >
                    {MANUAL_PAYMENT_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {formatPaymentMethod(method)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="create-payment-date" className="mb-1.5 block text-sm font-medium">
                  Payment date
                </label>
                <Input
                  id="create-payment-date"
                  type="date"
                  value={paymentForm.paymentDate}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, paymentDate: event.target.value }))}
                />
              </div>

              <div>
                <label htmlFor="create-payment-reference" className="mb-1.5 block text-sm font-medium">
                  Reference
                </label>
                <Input
                  id="create-payment-reference"
                  value={paymentForm.reference}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, reference: event.target.value }))}
                />
              </div>

              <div>
                <label htmlFor="create-payment-notes" className="mb-1.5 block text-sm font-medium">
                  Notes
                </label>
                <textarea
                  id="create-payment-notes"
                  rows={3}
                  value={paymentForm.notes}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, notes: event.target.value }))}
                  className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]"
                />
              </div>

              {paymentErrors.form ? (
                <p className="text-sm font-medium text-[var(--warning)]" role="alert">
                  {paymentErrors.form}
                </p>
              ) : null}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={closeCreate}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={paymentSaving || !selectedInvoice}>
                  {paymentSaving ? "Saving…" : "Record payment"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
