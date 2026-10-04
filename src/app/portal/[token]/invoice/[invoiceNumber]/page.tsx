import type { Metadata } from "next";
import { CustomerPortalInvalidView } from "@/features/portal/components/customer-portal-page";
import { PortalInvoiceView } from "@/features/portal/components/portal-invoice-view";
import { CustomerPortalAccessError, getPortalInvoiceDetailDto } from "@/server/portal/access";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ token: string; invoiceNumber: string }>;
  searchParams: Promise<{ payment?: string | string[] }>;
};

function paymentNoticeFromSearch(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "success" || raw === "cancelled") return raw;
  return null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { invoiceNumber } = await params;
  return {
    title: `Invoice ${decodeURIComponent(invoiceNumber)}`,
    robots: { index: false, follow: false },
  };
}

export default async function PortalInvoiceRoute({ params, searchParams }: PageProps) {
  const { token, invoiceNumber } = await params;
  const query = await searchParams;

  let invoice: Awaited<ReturnType<typeof getPortalInvoiceDetailDto>> | null = null;
  let accessDenied = false;
  try {
    invoice = await getPortalInvoiceDetailDto(token, decodeURIComponent(invoiceNumber));
  } catch (error) {
    if (error instanceof CustomerPortalAccessError) {
      accessDenied = true;
    } else {
      throw error;
    }
  }

  if (accessDenied || !invoice) {
    return <CustomerPortalInvalidView />;
  }

  return (
    <PortalInvoiceView invoice={invoice} paymentNotice={paymentNoticeFromSearch(query.payment)} />
  );
}
