import { CustomersPage } from "@/features/customers/components/customers-page";
import { redirect } from "next/navigation";
import { getCurrentUserAccess } from "@/server/auth/session-access";

export default async function CustomersRoute() {
  const access = await getCurrentUserAccess();
  if (!access) redirect("/login");

  return <CustomersPage readOnlyDemo={access.isReadOnlyDemo} />;
}