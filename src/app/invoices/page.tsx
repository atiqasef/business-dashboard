import { InvoicesPage } from "@/features/invoices/components/invoices-page";
import { redirect } from "next/navigation";
import { getCurrentUserAccess } from "@/server/auth/session-access";

export default async function InvoicesRoute() {
  const access = await getCurrentUserAccess();
  if (!access) redirect("/login");

  return <InvoicesPage readOnlyDemo={access.isReadOnlyDemo} />;
}
