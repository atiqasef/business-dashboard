import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { PortalInvoiceListItem, PortalStatusFilter, PortalSummary, PortalSortOption } from "@/server/portal/access";

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatStatusLabel(status: string) {
  return status.replace(/_/g, " ");
}

function getStatusTone(status: string) {
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

const FILTERS: Array<{ id: PortalStatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "unpaid", label: "Unpaid" },
  { id: "paid", label: "Paid" },
  { id: "overdue", label: "Overdue" },
  { id: "cancelled", label: "Cancelled" },
];

function buildQuery(options: {
  status: PortalStatusFilter;
  search: string;
  sort: PortalSortOption;
  page: number;
}) {
  const params = new URLSearchParams();
  if (options.status !== "all") params.set("status", options.status);
  if (options.search) params.set("search", options.search);
  if (options.sort !== "newest") params.set("sort", options.sort);
  if (options.page > 1) params.set("page", String(options.page));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function CustomerPortalInvalidView() {
  return (
    <div className="flex min-h-full items-center justify-center bg-[radial-gradient(circle_at_top,_#f8f4ee_0%,_var(--surface)_45%,_#e8eee9_100%)] px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] px-6 py-10 text-center shadow-sm">
        <p className="text-xs font-bold tracking-[0.16em] text-[var(--muted)] uppercase">Customer portal</p>
        <h1 className="mt-3 text-xl font-semibold tracking-[-0.03em]">Link unavailable</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          This portal link is invalid or has expired.
        </p>
      </div>
    </div>
  );
}

export function CustomerPortalPage({
  token,
  summary,
  invoices,
  pagination,
  filters,
}: {
  token: string;
  summary: PortalSummary;
  invoices: PortalInvoiceListItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  filters: { status: PortalStatusFilter; search: string; sort: PortalSortOption };
}) {
  const basePath = `/portal/${token}`;

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top,_#f8f4ee_0%,_var(--surface)_45%,_#e8eee9_100%)]">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <header className="rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] px-6 py-6 shadow-sm sm:px-8">
          <div className="flex items-start gap-4">
            {summary.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={summary.logoUrl}
                alt=""
                className="h-12 w-12 rounded-xl border border-[var(--line)] object-cover"
              />
            ) : null}
            <div>
              <p className="text-xs font-bold tracking-[0.16em] text-[var(--accent)] uppercase">Customer portal</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-[var(--ink-strong)]">
                {summary.businessName}
              </h1>
              <p className="mt-2 text-sm text-[var(--muted)]">Welcome, {summary.customerName}</p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-[var(--surface-soft)] px-4 py-3">
              <p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">Invoices</p>
              <p className="mt-1 text-xl font-semibold">{summary.invoiceCount}</p>
            </div>
            <div className="rounded-xl bg-[var(--surface-soft)] px-4 py-3">
              <p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">Outstanding</p>
              <p className="mt-1 text-xl font-semibold">{formatMoney(summary.outstandingTotal)}</p>
            </div>
            <div className="rounded-xl bg-[var(--surface-soft)] px-4 py-3">
              <p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">Overdue</p>
              <p className="mt-1 text-xl font-semibold">{summary.overdueCount}</p>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] px-4 py-4 shadow-sm sm:px-6">
          <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="portal-search" className="mb-1.5 block text-sm font-medium">
                Search invoice number
              </label>
              <input
                id="portal-search"
                name="search"
                defaultValue={filters.search}
                className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 text-sm"
                placeholder="INV-2026-000001"
              />
            </div>
            <div>
              <label htmlFor="portal-sort" className="mb-1.5 block text-sm font-medium">
                Sort
              </label>
              <select
                id="portal-sort"
                name="sort"
                defaultValue={filters.sort}
                className="h-10 rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-3 text-sm"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="due_date">Due date</option>
              </select>
            </div>
            {filters.status !== "all" ? <input type="hidden" name="status" value={filters.status} /> : null}
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-xl bg-[var(--ink)] px-4 text-sm font-semibold text-white"
            >
              Apply
            </button>
          </form>

          <div className="mt-4 flex flex-wrap gap-2">
            {FILTERS.map((filter) => {
              const href = `${basePath}${buildQuery({
                status: filter.id,
                search: filters.search,
                sort: filters.sort,
                page: 1,
              })}`;
              const active = filters.status === filter.id;
              return (
                <Link
                  key={filter.id}
                  href={href}
                  className={`inline-flex h-9 items-center rounded-xl px-3 text-sm font-semibold transition-colors ${
                    active
                      ? "bg-[var(--ink)] text-white"
                      : "border border-[var(--line-strong)] bg-[var(--surface-raised)] text-[var(--ink)] hover:bg-[var(--surface-soft)]"
                  }`}
                >
                  {filter.label}
                </Link>
              );
            })}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] shadow-sm">
          {invoices.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <h2 className="text-lg font-semibold">No invoices found</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                There are no invoices matching this view for your account.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {invoices.map((invoice) => (
                <li key={invoice.invoiceNumber} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{invoice.invoiceNumber}</p>
                      <Badge tone={getStatusTone(invoice.status)} className="capitalize">
                        {formatStatusLabel(invoice.status)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      Issued {formatDate(invoice.issueDate)}
                      {invoice.dueDate ? ` · Due ${formatDate(invoice.dueDate)}` : ""}
                    </p>
                    <p className="mt-1 text-sm">
                      <span className="font-medium">{formatMoney(invoice.total)}</span>
                      <span className="text-[var(--muted)]">
                        {" "}
                        · Paid {formatMoney(invoice.paidAmount)} · Outstanding{" "}
                        {formatMoney(invoice.outstandingAmount)}
                      </span>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`${basePath}/invoice/${encodeURIComponent(invoice.invoiceNumber)}`}
                      className="inline-flex h-9 items-center rounded-xl border border-[var(--line-strong)] bg-[var(--surface-raised)] px-3 text-sm font-semibold"
                    >
                      View
                    </Link>
                    <a
                      href={`/api/public/portal/${token}/invoices/${encodeURIComponent(invoice.invoiceNumber)}/pdf`}
                      className="inline-flex h-9 items-center rounded-xl border border-[var(--line-strong)] bg-[var(--surface-raised)] px-3 text-sm font-semibold"
                    >
                      PDF
                    </a>
                    {invoice.canPay ? (
                      <Link
                        href={`${basePath}/invoice/${encodeURIComponent(invoice.invoiceNumber)}`}
                        className="inline-flex h-9 items-center rounded-xl bg-[var(--ink)] px-3 text-sm font-semibold text-white"
                      >
                        Pay
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {pagination.totalPages > 1 ? (
          <nav className="flex items-center justify-between gap-3 text-sm" aria-label="Pagination">
            <p className="text-[var(--muted)]">
              Page {pagination.page} of {pagination.totalPages}
            </p>
            <div className="flex gap-2">
              {pagination.page > 1 ? (
                <Link
                  href={`${basePath}${buildQuery({
                    status: filters.status,
                    search: filters.search,
                    sort: filters.sort,
                    page: pagination.page - 1,
                  })}`}
                  className="inline-flex h-9 items-center rounded-xl border border-[var(--line-strong)] px-3 font-semibold"
                >
                  Previous
                </Link>
              ) : null}
              {pagination.page < pagination.totalPages ? (
                <Link
                  href={`${basePath}${buildQuery({
                    status: filters.status,
                    search: filters.search,
                    sort: filters.sort,
                    page: pagination.page + 1,
                  })}`}
                  className="inline-flex h-9 items-center rounded-xl border border-[var(--line-strong)] px-3 font-semibold"
                >
                  Next
                </Link>
              ) : null}
            </div>
          </nav>
        ) : null}

        <p className="text-center text-xs text-[var(--muted)]">Powered by Ledger</p>
      </div>
    </div>
  );
}
