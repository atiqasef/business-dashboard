import { getEmailConfig } from "@/server/email/config";
import { sendWithResend } from "@/server/email/resend-transport";
import type { SendEmailInput, SendEmailResult } from "@/server/email/types";

/** Application email entrypoint — invoice features depend on this, not Resend directly. */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const config = getEmailConfig();
  return sendWithResend(config, input);
}
