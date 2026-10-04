import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getHealth } from "@/server/api/health";
import { GET as getCronReminders } from "@/server/api/cron-invoice-reminders";
import { POST as stripeWebhook } from "@/server/api/stripe-webhook";
import * as db from "@/lib/db";
import { getMissingRequiredProductionEnv, getOptionalIntegrationStatus } from "@/server/config/env";
import { jsonRequest, readJson } from "../helpers/http";

describe("production env helpers", () => {
  const keys = [
    "RESEND_API_KEY",
    "EMAIL_FROM",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "OPENAI_API_KEY",
    "CRON_SECRET",
    "FAKE_REQUIRED_A",
  ] as const;
  const snapshot = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of keys) {
      const value = snapshot[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("reports missing required production env by name only", () => {
    const previous = {
      MONGODB_URI: process.env.MONGODB_URI,
      MONGODB_DB: process.env.MONGODB_DB,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    };

    try {
      delete process.env.MONGODB_DB;
      delete process.env.BETTER_AUTH_SECRET;
      // Keep MONGODB_URI for the shared test Mongo — simulate missing by checking helper output includes others.
      delete process.env.BETTER_AUTH_URL;
      delete process.env.NEXT_PUBLIC_APP_URL;

      const missing = getMissingRequiredProductionEnv();
      expect(missing).toEqual(
        expect.arrayContaining(["MONGODB_DB", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "NEXT_PUBLIC_APP_URL"]),
      );
      expect(JSON.stringify(missing)).not.toMatch(/mongodb:\/\/|sk-|whsec_/);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("reports optional integration configuration without values", () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.OPENAI_API_KEY;
    delete process.env.CRON_SECRET;

    expect(getOptionalIntegrationStatus()).toEqual({
      email: false,
      stripe: false,
      stripeWebhook: false,
      openai: false,
      cron: false,
    });

    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "billing@example.com";
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.CRON_SECRET = "cron";

    expect(getOptionalIntegrationStatus()).toEqual({
      email: true,
      stripe: true,
      stripeWebhook: true,
      openai: true,
      cron: true,
    });
  });
});

describe("GET /api/health", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok with no-store when MongoDB is reachable", async () => {
    const previousOpenAi = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const response = await getHealth();
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");

      const payload = await readJson(response);
      expect(payload).toMatchObject({
        status: "ok",
        checks: {
          app: "ok",
          mongodb: "ok",
          integrations: {
            openai: "not_configured",
          },
        },
      });

      const serialized = JSON.stringify(payload);
      expect(serialized).not.toMatch(/mongodb(\+srv)?:\/\//i);
      expect(serialized).not.toMatch(/sk-[A-Za-z0-9]{10,}|whsec_|BETTER_AUTH_SECRET=/i);
      expect(serialized).not.toMatch(/stack|ownerId|"_id"/i);
    } finally {
      if (previousOpenAi === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAi;
    }
  });

  it("returns degraded 503 when MongoDB ping fails", async () => {
    vi.spyOn(db, "connectMongo").mockRejectedValueOnce(new Error("ECONNREFUSED secret://mongodb-uri-should-not-leak"));

    const response = await getHealth();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const payload = await readJson(response);
    expect(payload).toMatchObject({
      status: "degraded",
      checks: { mongodb: "unavailable" },
    });
    expect(JSON.stringify(payload)).not.toContain("secret://");
    expect(JSON.stringify(payload)).not.toContain("ECONNREFUSED");
  });
});

describe("operational route cache headers", () => {
  it("sets no-store on unauthorized cron and unconfigured stripe webhook", async () => {
    const previousCron = process.env.CRON_SECRET;
    const previousStripe = process.env.STRIPE_SECRET_KEY;
    const previousWebhook = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.CRON_SECRET;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;

    try {
      const cron = await getCronReminders(jsonRequest("GET", "http://localhost/api/cron/invoice-reminders"));
      expect(cron.status).toBe(401);
      expect(cron.headers.get("Cache-Control")).toBe("no-store");

      const webhook = await stripeWebhook(
        jsonRequest("POST", "http://localhost/api/webhooks/stripe", { hello: "world" }),
      );
      expect(webhook.status).toBe(503);
      expect(webhook.headers.get("Cache-Control")).toBe("no-store");
    } finally {
      if (previousCron === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousCron;
      if (previousStripe === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = previousStripe;
      if (previousWebhook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = previousWebhook;
    }
  });
});
