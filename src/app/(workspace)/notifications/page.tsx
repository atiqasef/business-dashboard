import { redirect } from "next/navigation";
import { NotificationsPage } from "@/features/notifications/components/notifications-page";
import { getCurrentUserAccess } from "@/server/auth/session-access";

export default async function NotificationsRoute() {
  const access = await getCurrentUserAccess();
  if (!access) redirect("/login");

  return <NotificationsPage readOnlyDemo={access.isReadOnlyDemo} />;
}
