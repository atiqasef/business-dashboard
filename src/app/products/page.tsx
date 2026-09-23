import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { ProductsPage } from "@/features/products/components/products-page";

export default async function ProductsRoute() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  return <ProductsPage />;
}
