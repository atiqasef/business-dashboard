import { Resend } from "resend";
import type { EmailConfig } from "@/server/email/config";
import { EmailDeliveryError, type SendEmailInput, type SendEmailResult } from "@/server/email/types";

export async function sendWithResend(config: EmailConfig, input: SendEmailInput): Promise<SendEmailResult> {
  const resend = new Resend(config.apiKey);
  const from = config.fromName ? `${config.fromName} <${config.from}>` : config.from;

  const { data, error } = await resend.emails.send({
    from,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    text: input.text,
    attachments: input.attachments?.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      contentType: attachment.contentType,
    })),
  });

  if (error || !data?.id) {
    throw new EmailDeliveryError(error?.message || "Email provider rejected the send request");
  }

  return { id: data.id };
}
