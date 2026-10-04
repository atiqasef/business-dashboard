import { redirect } from "next/navigation";
import { SettingsPage } from "@/features/settings/components/settings-page";
import { getCurrentUserAccess } from "@/server/auth/session-access";
import { getBusinessProfile } from "@/server/settings/business-profile";

export default async function SettingsRoute() {
  const access = await getCurrentUserAccess();
  if (!access) redirect("/login");

  let initialProfile = null;
  try {
    initialProfile = await getBusinessProfile(access.session.user.id);
  } catch {
    initialProfile = null;
  }

  return (
    <SettingsPage
      readOnlyDemo={access.isReadOnlyDemo}
      initialProfile={initialProfile}
    />
  );
}
