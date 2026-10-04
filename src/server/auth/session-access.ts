import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isReadOnlyDemoUser } from "@/server/db/models/demo-account";

export async function getCurrentUserAccess() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  return {
    session,
    isReadOnlyDemo: await isReadOnlyDemoUser(session.user.id),
  };
}