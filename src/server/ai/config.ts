export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

export function isAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function getOpenAiApiKey() {
  return process.env.OPENAI_API_KEY?.trim() || null;
}

export function getOpenAiModel() {
  const model = process.env.OPENAI_MODEL?.trim();
  return model || DEFAULT_OPENAI_MODEL;
}
