import { redirect } from "next/navigation";
import { SettingsPage } from "@/features/settings/components/settings-page";
import type { PlanStatusView } from "@/features/settings/components/plan-status-card";
import { getCurrentUserAccess } from "@/server/auth/session-access";
import { resolveOrganizationForUser, toPublicOrganizationResponse } from "@/server/organizations/resolve";
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

  let planStatus: PlanStatusView | null = null;
  try {
    const context = await resolveOrganizationForUser(access.session.user.id, {
      displayName: access.session.user.name,
    });
    const publicOrg = toPublicOrganizationResponse(context);
    planStatus = {
      name: publicOrg.name,
      status: publicOrg.status,
      plan: publicOrg.plan,
      features: publicOrg.features,
      billing: publicOrg.billing,
    };
  } catch {
    planStatus = null;
  }

  return (
    <SettingsPage
      readOnlyDemo={access.isReadOnlyDemo}
      initialProfile={initialProfile}
      planStatus={planStatus}
    />
  );
}
