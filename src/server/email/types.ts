export type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Optional From display name only — never overrides the server EMAIL_FROM address. */
  fromDisplayName?: string;
  attachments?: EmailAttachment[];
};

export type SendEmailResult = {
  id: string;
};

export class EmailConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigurationError";
  }
}

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}
