import { EmailConfigurationError } from "@/server/email/types";

export type EmailConfig = {
  apiKey: string;
  from: string;
  fromName: string;
};

export function getEmailConfig(): EmailConfig {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  const fromName = process.env.EMAIL_FROM_NAME?.trim() || "Ledger";

  if (!apiKey || !from) {
    throw new EmailConfigurationError(
      "Email is not configured. Set RESEND_API_KEY and EMAIL_FROM.",
    );
  }

  return { apiKey, from, fromName };
}
