import { DashboardShell } from "@/components/layout/dashboard-shell";
import { redirect } from "next/navigation";
import { getCurrentUserAccess } from "@/server/auth/session-access";

export default async function Home() {
  const access = await getCurrentUserAccess();
  if (!access) redirect("/login");

  return <DashboardShell userName={access.session.user.name} readOnlyDemo={access.isReadOnlyDemo} />;
}
