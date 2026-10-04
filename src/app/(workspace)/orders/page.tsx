import { OrdersPage } from "@/features/orders/components/orders-page";
import { redirect } from "next/navigation";
import { getCurrentUserAccess } from "@/server/auth/session-access";

export default async function OrdersRoute() {
  const access = await getCurrentUserAccess();
  if (!access) redirect("/login");

  return <OrdersPage readOnlyDemo={access.isReadOnlyDemo} />;
}
