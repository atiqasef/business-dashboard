import { ProductsPage } from "@/features/products/components/products-page";
import { redirect } from "next/navigation";
import { getCurrentUserAccess } from "@/server/auth/session-access";

export default async function ProductsRoute() {
  const access = await getCurrentUserAccess();
  if (!access) redirect("/login");

  return <ProductsPage readOnlyDemo={access.isReadOnlyDemo} />;
}
