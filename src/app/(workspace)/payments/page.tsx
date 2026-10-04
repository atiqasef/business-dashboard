import { Suspense } from "react";
import { redirect } from "next/navigation";
import { WorkspaceLoading } from "@/components/layout/workspace-loading";
import { PaymentsPage } from "@/features/payments/components/payments-page";
import { getCurrentUserAccess } from "@/server/auth/session-access";

export default async function PaymentsRoute() {
  const access = await getCurrentUserAccess();
  if (!access) redirect("/login");

  return (
    <Suspense fallback={<WorkspaceLoading label="Loading payments" />}>
      <PaymentsPage readOnlyDemo={access.isReadOnlyDemo} />
    </Suspense>
  );
}
