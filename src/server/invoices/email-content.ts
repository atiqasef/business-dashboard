import type { InvoiceDocument, InvoiceStatus } from "@/server/db/models/invoice";

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatDate(value: Date | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function formatStatusLabel(status: InvoiceStatus) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function buildInvoiceEmailContent(options: {
  invoice: InvoiceDocument;
  status: InvoiceStatus;
  customerName: string;
  businessName?: string;
}) {
  const businessName = options.businessName?.trim() || "Ledger";
  const { invoice, status, customerName } = options;
  const greetingName = customerName.trim() || "there";
  const issueDate = formatDate(invoice.issueDate);
  const dueDate = invoice.dueDate ? formatDate(invoice.dueDate) : null;
  const total = formatMoney(invoice.total);
  const outstanding = formatMoney(invoice.outstandingAmount);
  const statusLabel = formatStatusLabel(status);

  const subject = `Invoice ${invoice.invoiceNumber} from ${businessName}`;

  const textLines = [
    `Hello ${greetingName},`,
    "",
    `Please find attached invoice ${invoice.invoiceNumber} from ${businessName}.`,
    "",
    `Invoice number: ${invoice.invoiceNumber}`,
    `Invoice date: ${issueDate}`,
    ...(dueDate ? [`Due date: ${dueDate}`] : []),
    `Total: ${total}`,
    `Outstanding: ${outstanding}`,
    `Status: ${statusLabel}`,
    "",
    "The invoice PDF is attached to this email.",
    "",
    "Thank you for your business.",
    businessName,
  ];

  const text = textLines.join("\n");

  const html = `
<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f5f7f6;font-family:Arial,Helvetica,sans-serif;color:#1f2a24;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7f6;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #d7ddd8;border-radius:12px;padding:28px;">
            <tr>
              <td style="font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#66736b;">${escapeHtml(businessName)}</td>
            </tr>
            <tr>
              <td style="padding-top:12px;font-size:22px;font-weight:700;">Invoice ${escapeHtml(invoice.invoiceNumber)}</td>
            </tr>
            <tr>
              <td style="padding-top:16px;font-size:14px;line-height:1.6;color:#334039;">
                Hello ${escapeHtml(greetingName)},
              </td>
            </tr>
            <tr>
              <td style="padding-top:12px;font-size:14px;line-height:1.6;color:#334039;">
                Please find attached invoice <strong>${escapeHtml(invoice.invoiceNumber)}</strong> from ${escapeHtml(businessName)}.
              </td>
            </tr>
            <tr>
              <td style="padding-top:20px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;line-height:1.7;color:#1f2a24;">
                  <tr><td style="color:#66736b;width:140px;">Invoice number</td><td>${escapeHtml(invoice.invoiceNumber)}</td></tr>
                  <tr><td style="color:#66736b;">Invoice date</td><td>${escapeHtml(issueDate)}</td></tr>
                  ${dueDate ? `<tr><td style="color:#66736b;">Due date</td><td>${escapeHtml(dueDate)}</td></tr>` : ""}
                  <tr><td style="color:#66736b;">Total</td><td>${escapeHtml(total)}</td></tr>
                  <tr><td style="color:#66736b;">Outstanding</td><td>${escapeHtml(outstanding)}</td></tr>
                  <tr><td style="color:#66736b;">Status</td><td>${escapeHtml(statusLabel)}</td></tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top:20px;font-size:14px;line-height:1.6;color:#334039;">
                The invoice PDF is attached to this email.
              </td>
            </tr>
            <tr>
              <td style="padding-top:24px;font-size:14px;line-height:1.6;color:#334039;">
                Thank you for your business.<br />
                ${escapeHtml(businessName)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`.trim();

  return { subject, html, text };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
