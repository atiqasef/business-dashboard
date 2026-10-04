import { InvoiceDetailPage } from "@/features/invoices/components/invoice-detail-page";
import { redirect } from "next/navigation";
import { getCurrentUserAccess } from "@/server/auth/session-access";

export default async function InvoiceDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const access = await getCurrentUserAccess();
  if (!access) redirect("/login");

  const { id } = await params;

  return <InvoiceDetailPage invoiceId={id} readOnlyDemo={access.isReadOnlyDemo} />;
}
