export type AiCompletionInput = {
  systemPrompt: string;
  /** Untrusted business analytics JSON string — treated strictly as data. */
  businessDataJson: string;
  userQuestion: string;
};

export type AiCompletionResult = {
  content: string;
};

export interface AiProvider {
  id: string;
  isConfigured: () => boolean;
  complete: (input: AiCompletionInput) => Promise<AiCompletionResult>;
}

export class AiProviderError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "AiProviderError";
    this.status = status;
  }
}
