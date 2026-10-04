import type { Metadata } from "next";
import { PublicInvoiceInvalidView, PublicInvoiceView } from "@/features/invoices/components/public-invoice-view";
import { resolvePublicInvoiceByToken } from "@/server/invoices/public-access";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ token: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const resolved = await resolvePublicInvoiceByToken(token);
  if (!resolved.ok) {
    return {
      title: "Invoice link",
      robots: { index: false, follow: false },
    };
  }

  return {
    title: `Invoice ${resolved.dto.invoiceNumber} · ${resolved.dto.business.businessName}`,
    robots: { index: false, follow: false },
  };
}

export default async function PublicInvoicePage({ params }: PageProps) {
  const { token } = await params;
  const resolved = await resolvePublicInvoiceByToken(token);

  if (!resolved.ok) {
    return <PublicInvoiceInvalidView />;
  }

  return <PublicInvoiceView invoice={resolved.dto} />;
}
