/**
 * Production environment helpers.
 * Never return secret values — only presence / validation status.
 */

const REQUIRED_PRODUCTION_ENV = [
  "MONGODB_URI",
  "MONGODB_DB",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "NEXT_PUBLIC_APP_URL",
] as const;

export type RequiredProductionEnv = (typeof REQUIRED_PRODUCTION_ENV)[number];

function present(name: string) {
  return Boolean(process.env[name]?.trim());
}

/** Required vars that are missing (names only — never values). */
export function getMissingRequiredProductionEnv(): RequiredProductionEnv[] {
  return REQUIRED_PRODUCTION_ENV.filter((name) => !present(name));
}

export function getOptionalIntegrationStatus() {
  return {
    email: present("RESEND_API_KEY") && present("EMAIL_FROM"),
    stripe: present("STRIPE_SECRET_KEY"),
    stripeWebhook: present("STRIPE_SECRET_KEY") && present("STRIPE_WEBHOOK_SECRET"),
    openai: present("OPENAI_API_KEY"),
    cron: present("CRON_SECRET"),
  };
}

/** Soft URL checks for operational readiness (no secret leakage). */
export function getAppUrlStatus() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
  const authUrl = process.env.BETTER_AUTH_URL?.trim() || "";
  let appUrlValid = false;
  let authUrlValid = false;

  try {
    const url = new URL(appUrl);
    appUrlValid = url.protocol === "http:" || url.protocol === "https:";
  } catch {
    appUrlValid = false;
  }

  try {
    const url = new URL(authUrl);
    authUrlValid = url.protocol === "http:" || url.protocol === "https:";
  } catch {
    authUrlValid = false;
  }

  return {
    appUrlConfigured: Boolean(appUrl),
    authUrlConfigured: Boolean(authUrl),
    appUrlValid,
    authUrlValid,
  };
}
