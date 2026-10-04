import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { getCurrentUserAccess } from "@/server/auth/session-access";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const access = await getCurrentUserAccess();
  if (!access) redirect("/login");

  return (
    <DashboardShell
      userName={access.session.user.name || ""}
      userEmail={access.session.user.email || ""}
      readOnlyDemo={access.isReadOnlyDemo}
    >
      {children}
    </DashboardShell>
  );
}
