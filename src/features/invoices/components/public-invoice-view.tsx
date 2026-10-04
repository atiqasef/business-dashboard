import { Badge } from "@/components/ui/badge";
import { PublicInvoicePayButton } from "@/features/invoices/components/public-invoice-pay-button";
import type { PublicInvoiceDto } from "@/server/invoices/public-access";

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

function formatBusinessAddress(address: PublicInvoiceDto["business"]["address"]) {
  return [address.street, [address.city, address.state].filter(Boolean).join(", "), address.postalCode, address.country]
    .filter(Boolean)
    .join(", ");
}

export function PublicInvoiceView({
  invoice,
  token,
  paymentNotice,
}: {
  invoice: PublicInvoiceDto;
  token: string;
  paymentNotice?: "success" | "cancelled" | null;
}) {
  const business = invoice.business;
  const addressLine = formatBusinessAddress(business.address);
  const billingLines = [
    invoice.customer.company,
    invoice.customer.address,
    [invoice.customer.city, invoice.customer.country].filter(Boolean).join(", "),
    invoice.customer.email,
    invoice.customer.phone,
  ].filter(Boolean) as string[];

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top,_#f8f4ee_0%,_var(--surface)_45%,_#e8eee9_100%)]">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        {paymentNotice === "success" ? (
          <div
            className="rounded-2xl border border-[var(--blue)]/20 bg-[var(--blue-soft)] px-4 py-3 text-sm text-[var(--ink)]"
            role="status"
          >
            Payment submitted. We are confirming your payment — this page updates when the payment is verified.
          </div>
        ) : null}
        {paymentNotice === "cancelled" ? (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] px-4 py-3 text-sm text-[var(--muted)]" role="status">
            Checkout was cancelled. No payment was recorded.
          </div>
        ) : null}

        <header className="rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] px-6 py-6 shadow-sm sm:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              {business.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={business.logoUrl}
                  alt=""
                  className="h-12 w-12 rounded-xl border border-[var(--line)] object-cover"
                />
              ) : null}
              <div>
                <p className="text-xs font-bold tracking-[0.16em] text-[var(--accent)] uppercase">Invoice</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-[var(--ink-strong)]">
                  {business.businessName}
                </h1>
                {business.legalName && business.legalName !== business.businessName ? (
                  <p className="mt-1 text-sm text-[var(--muted)]">{business.legalName}</p>
                ) : null}
              </div>
            </div>
            <Badge tone={getStatusTone(invoice.status)} className="self-start capitalize">
              {formatStatusLabel(invoice.status)}
            </Badge>
          </div>

          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-[var(--muted)]">
            {business.email ? <span>{business.email}</span> : null}
            {business.phone ? <span>{business.phone}</span> : null}
            {business.website ? (
              <a href={business.website} className="text-[var(--accent-strong)] hover:underline">
                {business.website.replace(/^https?:\/\//, "")}
              </a>
            ) : null}
            {addressLine ? <span className="basis-full">{addressLine}</span> : null}
          </div>
        </header>

        <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] shadow-sm">
          <div className="border-b border-[var(--line)] px-6 py-6 sm:px-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">Invoice number</p>
                <p className="mt-1 text-2xl font-semibold tracking-[-0.03em]">{invoice.invoiceNumber}</p>
              </div>
              <div className="text-sm text-[var(--muted)] sm:text-right">
                <p>Issued {formatDate(invoice.issueDate)}</p>
                {invoice.dueDate ? <p className="mt-1">Due {formatDate(invoice.dueDate)}</p> : null}
              </div>
            </div>

            <div className="mt-6">
              <p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">Bill to</p>
              <p className="mt-2 font-semibold">{invoice.customer.name}</p>
              {billingLines.map((line) => (
                <p key={line} className="text-sm text-[var(--muted)]">
                  {line}
                </p>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left">
              <thead className="border-b border-[var(--line)] bg-[var(--surface-soft)] text-[11px] font-bold tracking-[0.12em] text-[var(--muted)] uppercase">
                <tr>
                  <th className="px-6 py-3 font-semibold sm:px-8">Item</th>
                  <th className="px-4 py-3 font-semibold">Qty</th>
                  <th className="px-4 py-3 font-semibold">Unit price</th>
                  <th className="px-6 py-3 font-semibold sm:pr-8">Line total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {invoice.items.map((item, index) => (
                  <tr key={`${item.productName}-${index}`} className="text-sm">
                    <td className="px-6 py-4 font-medium sm:px-8">{item.productName}</td>
                    <td className="px-4 py-4 text-[var(--muted)]">{item.quantity}</td>
                    <td className="px-4 py-4 text-[var(--muted)]">{formatMoney(item.unitPrice)}</td>
                    <td className="px-6 py-4 font-medium sm:pr-8">{formatMoney(item.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-6 border-t border-[var(--line)] px-6 py-6 sm:grid-cols-2 sm:px-8">
            <div className="space-y-4">
              {invoice.notes ? (
                <div>
                  <p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">Notes</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{invoice.notes}</p>
                </div>
              ) : null}
              {business.invoiceNotes ? (
                <div>
                  <p className="text-xs font-bold tracking-[0.12em] text-[var(--muted)] uppercase">Payment notes</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">{business.invoiceNotes}</p>
                </div>
              ) : null}
            </div>

            <div className="space-y-2 text-sm sm:ml-auto sm:w-full sm:max-w-xs">
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
              <div className="flex justify-between gap-4">
                <span className="text-[var(--muted)]">Amount paid</span>
                <span className="font-medium text-[var(--positive)]">{formatMoney(invoice.paidAmount)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="font-semibold">Outstanding</span>
                <span className="font-semibold">{formatMoney(invoice.outstandingAmount)}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] px-6 py-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <p className="text-sm font-semibold">Actions</p>
            <p className="mt-1 text-sm text-[var(--muted)]">{invoice.payment.message}</p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <a
              href={invoice.pdfUrl}
              className="inline-flex h-10 items-center rounded-xl border border-[var(--line-strong)] bg-[var(--surface-raised)] px-4 text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--surface-soft)]"
            >
              Download PDF
            </a>
            <PublicInvoicePayButton
              token={token}
              canPay={invoice.payment.canPay}
              disabledReason={invoice.payment.message}
            />
          </div>
        </section>

        <p className="text-center text-xs text-[var(--muted)]">Powered by Ledger</p>
      </div>
    </div>
  );
}

export function PublicInvoiceInvalidView() {
  return (
    <div className="flex min-h-full items-center justify-center bg-[radial-gradient(circle_at_top,_#f8f4ee_0%,_var(--surface)_45%,_#e8eee9_100%)] px-4 py-16">
      <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] px-6 py-10 text-center shadow-sm">
        <p className="text-xs font-bold tracking-[0.16em] text-[var(--muted)] uppercase">Invoice link</p>
        <h1 className="mt-3 text-xl font-semibold tracking-[-0.03em]">Link unavailable</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          This invoice link is invalid or has expired.
        </p>
      </div>
    </div>
  );
}
