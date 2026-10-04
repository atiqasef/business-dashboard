import { redirect } from "next/navigation";
import { APP_HOME_PATH } from "@/lib/app-paths";
import { getCurrentUserAccess } from "@/server/auth/session-access";

/** Legacy welcome page — send authenticated users to the live dashboard. */
export default async function DashboardPage() {
  const access = await getCurrentUserAccess();
  if (!access) redirect("/login");
  redirect(APP_HOME_PATH);
}
