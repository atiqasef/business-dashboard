import PDFDocument from "pdfkit";
import type { InvoiceDocument, InvoiceStatus } from "@/server/db/models/invoice";

export type InvoicePdfCustomerDetails = {
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
};

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

export function invoicePdfFilename(invoiceNumber: string) {
  const safe = invoiceNumber.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `invoice-${safe || "document"}.pdf`;
}

function drawHorizontalRule(doc: PDFKit.PDFDocument, y: number, left: number, right: number) {
  doc
    .moveTo(left, y)
    .lineTo(right, y)
    .strokeColor("#D7DDD8")
    .lineWidth(1)
    .stroke();
}

export async function buildInvoicePdfBuffer(options: {
  invoice: InvoiceDocument;
  status: InvoiceStatus;
  customer: InvoicePdfCustomerDetails;
  businessName?: string;
}): Promise<Buffer> {
  const { invoice, status, customer } = options;
  const businessName = options.businessName?.trim() || "Ledger";

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `Invoice ${invoice.invoiceNumber}`, Author: businessName } });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    doc.fillColor("#1F2A24").font("Helvetica-Bold").fontSize(20).text(businessName, left, 48, { width: width * 0.55 });
    doc.font("Helvetica").fontSize(10).fillColor("#66736B").text("Business Management Dashboard", left, 74);

    doc.fillColor("#1F2A24").font("Helvetica-Bold").fontSize(22).text("INVOICE", left, 48, { width, align: "right" });
    doc.font("Helvetica").fontSize(11).fillColor("#334039");
    doc.text(invoice.invoiceNumber, left, 78, { width, align: "right" });
    doc.text(`Status: ${formatStatusLabel(status)}`, left, 94, { width, align: "right" });

    drawHorizontalRule(doc, 120, left, right);

    doc.font("Helvetica-Bold").fontSize(9).fillColor("#66736B").text("ISSUE DATE", left, 138);
    doc.font("Helvetica").fontSize(11).fillColor("#1F2A24").text(formatDate(invoice.issueDate), left, 152);
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#66736B").text("DUE DATE", left + 160, 138);
    doc.font("Helvetica").fontSize(11).fillColor("#1F2A24").text(formatDate(invoice.dueDate), left + 160, 152);

    doc.font("Helvetica-Bold").fontSize(9).fillColor("#66736B").text("BILL TO", left, 190);
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#1F2A24").text(customer.name, left, 206);

    let customerY = 224;
    doc.font("Helvetica").fontSize(10).fillColor("#334039");
    if (customer.company) {
      doc.text(customer.company, left, customerY);
      customerY += 14;
    }
    if (customer.email) {
      doc.text(customer.email, left, customerY);
      customerY += 14;
    }
    if (customer.phone) {
      doc.text(customer.phone, left, customerY);
      customerY += 14;
    }
    const addressLine = [customer.address, customer.city, customer.country].filter(Boolean).join(", ");
    if (addressLine) {
      doc.text(addressLine, left, customerY, { width: width * 0.55 });
      customerY += 14;
    }

    const tableTop = Math.max(customerY + 24, 280);
    const colProduct = left;
    const colQty = left + width * 0.52;
    const colUnit = left + width * 0.64;
    const colTotal = left + width * 0.8;

    doc.rect(left, tableTop, width, 24).fill("#F3F6F4");
    doc.fillColor("#66736B").font("Helvetica-Bold").fontSize(9);
    doc.text("ITEM", colProduct + 8, tableTop + 8);
    doc.text("QTY", colQty, tableTop + 8, { width: width * 0.1, align: "right" });
    doc.text("UNIT PRICE", colUnit, tableTop + 8, { width: width * 0.14, align: "right" });
    doc.text("LINE TOTAL", colTotal, tableTop + 8, { width: right - colTotal, align: "right" });

    let rowY = tableTop + 32;
    doc.font("Helvetica").fontSize(10).fillColor("#1F2A24");

    for (const item of invoice.items) {
      if (rowY > doc.page.height - 180) {
        doc.addPage();
        rowY = doc.page.margins.top;
      }

      const nameHeight = doc.heightOfString(item.productName, { width: width * 0.48 });
      doc.text(item.productName, colProduct + 8, rowY, { width: width * 0.48 });
      doc.text(String(item.quantity), colQty, rowY, { width: width * 0.1, align: "right" });
      doc.text(formatMoney(item.unitPrice), colUnit, rowY, { width: width * 0.14, align: "right" });
      doc.text(formatMoney(item.lineTotal), colTotal, rowY, { width: right - colTotal, align: "right" });
      rowY += Math.max(nameHeight, 14) + 12;
      drawHorizontalRule(doc, rowY - 4, left, right);
    }

    const summaryTop = rowY + 16;
    const summaryLabelX = left + width * 0.55;
    const summaryValueWidth = right - summaryLabelX;

    const summaryRows: Array<[string, string, boolean?]> = [
      ["Subtotal", formatMoney(invoice.subtotal)],
      ["Discount", formatMoney(invoice.discount)],
      ["Tax", formatMoney(invoice.tax)],
      ["Total", formatMoney(invoice.total), true],
      ["Amount paid", formatMoney(invoice.paidAmount)],
      ["Outstanding", formatMoney(invoice.outstandingAmount), true],
    ];

    let summaryY = summaryTop;
    for (const [label, value, emphasize] of summaryRows) {
      doc.font(emphasize ? "Helvetica-Bold" : "Helvetica").fontSize(emphasize ? 11 : 10).fillColor("#1F2A24");
      doc.text(label, summaryLabelX, summaryY, { width: summaryValueWidth * 0.55 });
      doc.text(value, summaryLabelX, summaryY, { width: summaryValueWidth, align: "right" });
      summaryY += emphasize ? 20 : 16;
    }

    summaryY += 12;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#66736B").text("PAYMENT STATUS", left, summaryY);
    summaryY += 14;
    doc.font("Helvetica").fontSize(10).fillColor("#1F2A24").text(formatStatusLabel(status), left, summaryY);

    if (invoice.notes) {
      summaryY += 28;
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#66736B").text("NOTES", left, summaryY);
      summaryY += 14;
      doc.font("Helvetica").fontSize(10).fillColor("#334039").text(invoice.notes, left, summaryY, { width });
    }

    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#8A968F")
      .text("Generated by Ledger · Amounts shown in USD", left, doc.page.height - 40, {
        width,
        align: "center",
      });

    doc.end();
  });
}
