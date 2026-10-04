import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/db";
import {
  getAppUrlStatus,
  getMissingRequiredProductionEnv,
  getOptionalIntegrationStatus,
} from "@/server/config/env";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Unauthenticated deployment health check.
 * Returns safe operational status only — never secrets, URIs, owner IDs, or stack traces.
 */
export async function GET() {
  const urls = getAppUrlStatus();
  const integrations = getOptionalIntegrationStatus();
  const missingRequired =
    process.env.NODE_ENV === "production" ? getMissingRequiredProductionEnv() : [];

  let mongodb: "ok" | "unavailable" = "unavailable";
  try {
    const database = await connectMongo();
    await database.command({ ping: 1 });
    mongodb = "ok";
  } catch {
    mongodb = "unavailable";
  }

  const ready =
    mongodb === "ok" &&
    (process.env.NODE_ENV !== "production" ||
      (missingRequired.length === 0 && urls.appUrlValid && urls.authUrlValid));

  const body = {
    status: ready ? ("ok" as const) : ("degraded" as const),
    checks: {
      app: "ok" as const,
      mongodb,
      urls: {
        appUrlConfigured: urls.appUrlConfigured,
        authUrlConfigured: urls.authUrlConfigured,
        appUrlValid: urls.appUrlValid,
        authUrlValid: urls.authUrlValid,
      },
      integrations: {
        email: integrations.email ? ("configured" as const) : ("not_configured" as const),
        stripe: integrations.stripe ? ("configured" as const) : ("not_configured" as const),
        stripeWebhook: integrations.stripeWebhook
          ? ("configured" as const)
          : ("not_configured" as const),
        openai: integrations.openai ? ("configured" as const) : ("not_configured" as const),
        cron: integrations.cron ? ("configured" as const) : ("not_configured" as const),
      },
      ...(missingRequired.length > 0 ? { missingRequiredEnv: missingRequired } : {}),
    },
  };

  // Guard against accidental secret material in the JSON body (values, not env names).
  const serialized = JSON.stringify(body);
  if (/mongodb(\+srv)?:\/\/|sk-[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]+|re_[A-Za-z0-9]{10,}/i.test(serialized)) {
    return NextResponse.json(
      { status: "degraded", error: "Health check failed safe serialization" },
      { status: 503, headers: NO_STORE },
    );
  }

  return NextResponse.json(body, {
    status: ready ? 200 : 503,
    headers: NO_STORE,
  });
}
