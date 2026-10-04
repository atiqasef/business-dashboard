import { NextResponse } from "next/server";
import { isReadOnlyDemoUser } from "@/server/db/models/demo-account";

export async function assertDemoWriteAllowed(userId: string) {
  if (await isReadOnlyDemoUser(userId)) {
    return NextResponse.json({ error: "Demo account is read-only" }, { status: 403 });
  }

  return null;
}