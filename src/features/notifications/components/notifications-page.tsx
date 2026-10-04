"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Bell,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  Loader2,
  MailWarning,
  RefreshCw,
  Search,
  Send,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ReminderType = "due_soon" | "overdue" | "manual";
type ReminderStatus = "sent" | "failed";
type DatePreset = "all_time" | "last_7_days" | "last_30_days" | "last_90_days" | "custom";

type ReminderItem = {
  id: string;
  invoiceId: string;
  customerId: string;
  invoiceNumber: string;
  customerName: string;
  type: ReminderType;
  recipientEmail: string;
  status: ReminderStatus;
  sentAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type Overview = {
  overdueInvoices: number;
  dueSoonInvoices: number;
  remindersSent: number;
  remindersFailed: number;
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  all_time: "All time",
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  last_90_days: "Last 90 days",
  custom: "Custom range",
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
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

function formatType(type: ReminderType) {
  return type.replace(/_/g, " ");
}

export function NotificationsPage({ readOnlyDemo }: { readOnlyDemo: boolean }) {
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [overview, setOverview] = useState<Overview>({
    overdueInvoices: 0,
    dueSoonInvoices: 0,
    remindersSent: 0,
    remindersFailed: 0,
  });
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | ReminderStatus>("all");
  const [type, setType] = useState<"all" | ReminderType>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("all_time");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [page, setPage] = useState(1);
  const [refreshTick, setRefreshTick] = useState(0);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [selected, setSelected] = useState<ReminderItem | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [sendingManual, setSendingManual] = useState(false);
  const [manualInvoiceId, setManualInvoiceId] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [searchDraft]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadReminders() {
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
        if (type !== "all") params.set("type", type);
        if (datePreset === "custom") {
          if (customStart) params.set("start", customStart);
          if (customEnd) params.set("end", customEnd);
        }

        const response = await fetch(`/api/notifications/reminders?${params.toString()}`, {
          signal: controller.signal,
          credentials: "include",
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load reminders.");

        setReminders(payload.data);
        setPagination(payload.pagination);
        setOverview(payload.overview);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load reminders.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadReminders();
    return () => controller.abort();
  }, [page, search, status, type, datePreset, customStart, customEnd, refreshTick]);

  async function retryReminder(reminder: ReminderItem) {
    if (readOnlyDemo || retryingId) return;
    setRetryingId(reminder.id);
    setFeedback("");
    setError("");
    try {
      const response = await fetch(`/api/notifications/reminders/${reminder.id}/retry`, {
        method: "POST",
        credentials: "include",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to retry reminder.");
      setFeedback(`Reminder resent to ${payload.data?.to ?? "customer"}.`);
      setSelected(null);
      setRefreshTick((current) => current + 1);
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Unable to retry reminder.");
    } finally {
      setRetryingId(null);
    }
  }

  async function sendManualReminder(event: React.FormEvent) {
    event.preventDefault();
    if (readOnlyDemo || sendingManual || !manualInvoiceId.trim()) return;
    setSendingManual(true);
    setFeedback("");
    setError("");
    try {
      const response = await fetch(`/api/invoices/${manualInvoiceId.trim()}/reminder`, {
        method: "POST",
        credentials: "include",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to send reminder.");
      setFeedback(`Reminder sent for ${payload.data?.invoiceNumber ?? "invoice"}.`);
      setManualInvoiceId("");
      setRefreshTick((current) => current + 1);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Unable to send reminder.");
    } finally {
      setSendingManual(false);
    }
  }

  const metrics = [
    {
      label: "Overdue invoices",
      value: formatNumber(overview.overdueInvoices),
      detail: "Open invoices past due date",
      icon: AlertTriangle,
    },
    {
      label: "Due soon",
      value: formatNumber(overview.dueSoonInvoices),
      detail: "Due within the next 3 days",
      icon: Clock3,
    },
    {
      label: "Reminders sent",
      value: formatNumber(overview.remindersSent),
      detail: "Successful reminder emails",
      icon: Send,
    },
    {
      label: "Reminders failed",
      value: formatNumber(overview.remindersFailed),
      detail: "Failed delivery attempts",
      icon: MailWarning,
    },
  ];

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-bold tracking-[0.18em] text-[var(--accent)] uppercase">Workspace / Notifications</p>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Notifications</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Track overdue invoices and payment reminder history. Automated reminders run on a daily schedule.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {readOnlyDemo ? <Badge tone="accent">Read-only demo</Badge> : null}
          <Button type="button" variant="secondary" onClick={() => setRefreshTick((current) => current + 1)}>
            <RefreshCw className="size-4" aria-hidden="true" /> Refresh
          </Button>
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

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Reminder overview">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card key={metric.label}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold tracking-[0.14em] text-[var(--muted)] uppercase">{metric.label}</p>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.03em]">{metric.value}</p>
                </div>
                <span className="grid size-10 place-items-center rounded-xl bg-[var(--surface-soft)] text-[var(--ink)]">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
              </div>
              <p className="mt-3 text-xs text-[var(--muted)]">{metric.detail}</p>
            </Card>
          );
        })}
      </section>

      {!readOnlyDemo ? (
        <Card className="mt-6">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Send payment reminder</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Enter an invoice ID from the invoice detail page, or use Send Reminder there directly.
          </p>
          <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={sendManualReminder}>
            <Input
              value={manualInvoiceId}
              onChange={(event) => setManualInvoiceId(event.target.value)}
              placeholder="Invoice ID"
              aria-label="Invoice ID"
              className="sm:max-w-md"
            />
            <Button type="submit" variant="primary" disabled={sendingManual || !manualInvoiceId.trim()}>
              {sendingManual ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
              {sendingManual ? "Sending…" : "Send reminder"}
            </Button>
          </form>
        </Card>
      ) : null}

      <Card className="mt-6" padding="none">
        <div className="flex flex-col gap-3 border-b border-[var(--line)] p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor="reminder-search" className="mb-1.5 block text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">
                Search
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
                <Input
                  id="reminder-search"
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="Invoice, customer, email…"
                  className="pl-9"
                />
              </div>
            </div>
            <div>
              <label htmlFor="reminder-status" className="mb-1.5 block text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">
                Status
              </label>
              <select
                id="reminder-status"
                className="h-10 rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 text-sm"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as "all" | ReminderStatus);
                  setPage(1);
                }}
              >
                <option value="all">All statuses</option>
                <option value="sent">Sent</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            <div>
              <label htmlFor="reminder-type" className="mb-1.5 block text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">
                Type
              </label>
              <select
                id="reminder-type"
                className="h-10 rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 text-sm"
                value={type}
                onChange={(event) => {
                  setType(event.target.value as "all" | ReminderType);
                  setPage(1);
                }}
              >
                <option value="all">All types</option>
                <option value="manual">Manual</option>
                <option value="due_soon">Due soon</option>
                <option value="overdue">Overdue</option>
              </select>
            </div>
            <div>
              <label htmlFor="reminder-date" className="mb-1.5 block text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">
                Date range
              </label>
              <select
                id="reminder-date"
                className="h-10 rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 text-sm"
                value={datePreset}
                onChange={(event) => {
                  setDatePreset(event.target.value as DatePreset);
                  setPage(1);
                }}
              >
                {(Object.keys(DATE_PRESET_LABELS) as DatePreset[]).map((preset) => (
                  <option key={preset} value={preset}>
                    {DATE_PRESET_LABELS[preset]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {datePreset === "custom" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input type="date" value={customStart} onChange={(event) => { setCustomStart(event.target.value); setPage(1); }} aria-label="Start date" />
              <Input type="date" value={customEnd} onChange={(event) => { setCustomEnd(event.target.value); setPage(1); }} aria-label="End date" />
            </div>
          ) : null}
        </div>

        {loading ? (
          <div className="space-y-3 p-5 sm:p-6" aria-busy="true" aria-label="Loading reminders">
            {[1, 2, 3, 4, 5].map((item) => (
              <div key={item} className="h-14 animate-pulse rounded-xl bg-[var(--surface-soft)]" />
            ))}
          </div>
        ) : reminders.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
              <Bell className="size-7" aria-hidden="true" />
            </span>
            <h2 className="mt-5 text-lg font-semibold">No reminder history yet</h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">
              Payment reminders you send — or automated due-soon/overdue emails — will appear here.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[960px] text-left">
                <thead className="border-y border-[var(--line)] bg-[var(--surface-soft)] text-[11px] font-bold tracking-[0.12em] text-[var(--muted)] uppercase">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Date</th>
                    <th className="px-5 py-3 font-semibold">Invoice</th>
                    <th className="px-5 py-3 font-semibold">Customer</th>
                    <th className="px-5 py-3 font-semibold">Type</th>
                    <th className="px-5 py-3 font-semibold">Recipient</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {reminders.map((reminder) => (
                    <tr key={reminder.id} className="text-sm">
                      <td className="px-5 py-4 text-[var(--muted)]">{formatDateTime(reminder.createdAt)}</td>
                      <td className="px-5 py-4">
                        <Link href={`/invoices/${reminder.invoiceId}`} className="font-medium hover:text-[var(--accent-strong)]">
                          {reminder.invoiceNumber}
                        </Link>
                      </td>
                      <td className="px-5 py-4 font-medium">{reminder.customerName}</td>
                      <td className="px-5 py-4 capitalize text-[var(--muted)]">{formatType(reminder.type)}</td>
                      <td className="px-5 py-4 text-[var(--muted)]">{reminder.recipientEmail}</td>
                      <td className="px-5 py-4">
                        <Badge tone={reminder.status === "sent" ? "positive" : "warning"}>{reminder.status}</Badge>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1">
                          <Button type="button" variant="icon" aria-label="View reminder" onClick={() => setSelected(reminder)}>
                            <Eye className="size-4" aria-hidden="true" />
                          </Button>
                          {!readOnlyDemo && reminder.status === "failed" ? (
                            <Button
                              type="button"
                              variant="icon"
                              aria-label="Retry reminder"
                              disabled={retryingId === reminder.id}
                              onClick={() => void retryReminder(reminder)}
                            >
                              {retryingId === reminder.id ? (
                                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                              ) : (
                                <RefreshCw className="size-4" aria-hidden="true" />
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
              {reminders.map((reminder) => (
                <div key={reminder.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{reminder.invoiceNumber}</p>
                      <p className="mt-1 text-sm text-[var(--muted)]">{reminder.customerName}</p>
                    </div>
                    <Badge tone={reminder.status === "sent" ? "positive" : "warning"}>{reminder.status}</Badge>
                  </div>
                  <p className="text-sm capitalize text-[var(--muted)]">
                    {formatType(reminder.type)} · {formatDateTime(reminder.createdAt)}
                  </p>
                  <Button type="button" variant="secondary" className="h-9 w-full" onClick={() => setSelected(reminder)}>
                    View details
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3 border-t border-[var(--line)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="text-sm text-[var(--muted)]">
                Page {pagination.page} of {Math.max(pagination.totalPages, 1)} · {formatNumber(pagination.total)} reminders
              </p>
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" className="h-9" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                  <ChevronLeft className="size-4" aria-hidden="true" /> Previous
                </Button>
                <Button type="button" variant="secondary" className="h-9" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((current) => current + 1)}>
                  Next <ChevronRight className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {selected ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="reminder-detail-title">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-[var(--line)] bg-[var(--surface-raised)] p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold tracking-[0.14em] text-[var(--muted)] uppercase">Reminder details</p>
                <h2 id="reminder-detail-title" className="mt-1 text-xl font-semibold tracking-[-0.02em]">
                  {selected.invoiceNumber}
                </h2>
              </div>
              <Button type="button" variant="icon" aria-label="Close reminder details" onClick={() => setSelected(null)}>
                <X className="size-5" aria-hidden="true" />
              </Button>
            </div>

            <dl className="mt-5 grid gap-3 text-sm">
              {[
                ["Customer", selected.customerName],
                ["Type", formatType(selected.type)],
                ["Recipient", selected.recipientEmail],
                ["Status", selected.status],
                ["Created", formatDateTime(selected.createdAt)],
                ["Sent", formatDateTime(selected.sentAt)],
                ["Failed", formatDateTime(selected.failedAt)],
                ["Error", selected.errorMessage || "—"],
              ].map(([label, value]) => (
                <div key={label} className="grid grid-cols-[120px_1fr] gap-3 border-b border-[var(--line)] pb-3">
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
              {!readOnlyDemo && selected.status === "failed" ? (
                <Button type="button" variant="primary" disabled={retryingId === selected.id} onClick={() => void retryReminder(selected)}>
                  {retryingId === selected.id ? "Retrying…" : "Retry reminder"}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
