import { assertSafeAssistantContext, buildAssistantBusinessContext } from "@/server/ai/build-context";
import { isAiConfigured } from "@/server/ai/config";
import { getAiProvider } from "@/server/ai/openai-provider";
import { BUSINESS_ASSISTANT_SYSTEM_PROMPT } from "@/server/ai/prompts";
import { AiProviderError } from "@/server/ai/provider";
import {
  ASSISTANT_QUESTION_MAX_LENGTH,
  normalizeAssistantResponse,
  type AssistantResponse,
} from "@/server/ai/schemas";
import { EntitlementError } from "@/server/entitlements/errors";
import { assertFeature } from "@/server/entitlements/service";
import { resolveOrganizationForUser } from "@/server/organizations/resolve";

export class AssistantValidationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AssistantValidationError";
    this.status = status;
  }
}

export class AssistantServiceError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "AssistantServiceError";
    this.status = status;
  }
}

export function parseAssistantQuestion(raw: unknown) {
  if (typeof raw !== "string") {
    throw new AssistantValidationError("question must be a string");
  }
  const question = raw.trim();
  if (!question) throw new AssistantValidationError("question is required");
  if (question.length > ASSISTANT_QUESTION_MAX_LENGTH) {
    throw new AssistantValidationError(`question must be at most ${ASSISTANT_QUESTION_MAX_LENGTH} characters`);
  }
  return question;
}

export type AskBusinessAssistantResult = {
  data: AssistantResponse;
  /** Exposed only for tests — never returned by the HTTP API. */
  debugContext?: ReturnType<typeof buildAssistantBusinessContext> extends Promise<infer T> ? T : never;
};

/**
 * Read-only business analytics assistant.
 * Owner identity must come exclusively from the authenticated session.
 */
export async function askBusinessAssistant(options: {
  ownerId: string;
  question: unknown;
  /** Test-only: inject a provider and optionally return context. */
  provider?: ReturnType<typeof getAiProvider>;
  includeDebugContext?: boolean;
}): Promise<{ data: AssistantResponse; debugContext?: Awaited<ReturnType<typeof buildAssistantBusinessContext>> }> {
  if (!options.ownerId || typeof options.ownerId !== "string") {
    throw new AssistantServiceError("Authentication required", 401);
  }

  const question = parseAssistantQuestion(options.question);
  const provider = options.provider ?? getAiProvider();

  if (!provider.isConfigured()) {
    throw new AssistantServiceError("AI assistant is not configured.", 503);
  }

  try {
    const org = await resolveOrganizationForUser(options.ownerId);
    assertFeature(org.organization, "aiAssistant");
  } catch (error) {
    if (error instanceof EntitlementError) {
      throw new AssistantServiceError(error.message, error.status);
    }
    throw error;
  }

  const built = await buildAssistantBusinessContext(options.ownerId, question);
  const businessDataJson = assertSafeAssistantContext(built.context);

  let completionContent: string;
  try {
    const completion = await provider.complete({
      systemPrompt: BUSINESS_ASSISTANT_SYSTEM_PROMPT,
      businessDataJson,
      userQuestion: question,
    });
    completionContent = completion.content;
  } catch (error) {
    if (error instanceof AiProviderError) {
      throw new AssistantServiceError(error.message, error.status);
    }
    throw new AssistantServiceError("AI assistant is temporarily unavailable. Please try again.", 502);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(completionContent);
  } catch {
    throw new AssistantServiceError("AI assistant returned an unreadable response. Please try again.", 502);
  }

  let data: AssistantResponse;
  try {
    data = normalizeAssistantResponse(parsed);
  } catch {
    throw new AssistantServiceError("AI assistant returned an unexpected response. Please try again.", 502);
  }

  // Prefer authoritative period label from analytics over free-form model period text.
  data.period = built.context.period.label;

  return {
    data,
    ...(options.includeDebugContext ? { debugContext: built } : {}),
  };
}

export function getAssistantConfigurationState() {
  return {
    configured: isAiConfigured(),
  };
}
