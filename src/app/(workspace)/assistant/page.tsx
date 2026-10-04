import { AssistantPage } from "@/features/assistant/components/assistant-page";
import { redirect } from "next/navigation";
import { getAssistantConfigurationState } from "@/server/ai/business-assistant";
import { getCurrentUserAccess } from "@/server/auth/session-access";

export const dynamic = "force-dynamic";

export default async function AssistantRoute() {
  const access = await getCurrentUserAccess();
  if (!access) redirect("/login");

  const { configured } = getAssistantConfigurationState();

  return <AssistantPage configured={configured} readOnlyDemo={access.isReadOnlyDemo} />;
}
