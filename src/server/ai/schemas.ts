export type AssistantKeyMetric = {
  label: string;
  value: string;
};

export type AssistantResponse = {
  answer: string;
  keyMetrics?: AssistantKeyMetric[];
  period?: string;
  sources?: string[];
};

export const ASSISTANT_QUESTION_MAX_LENGTH = 1000;
export const ASSISTANT_ANSWER_MAX_LENGTH = 4000;
export const ASSISTANT_SOURCE_WHITELIST = [
  "Dashboard",
  "Sales analytics",
  "Product analytics",
  "Customer analytics",
  "Invoice analytics",
  "Payment analytics",
  "Follow-up candidates",
] as const;

function stripUnsafeMarkup(value: string) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
}

function asTrimmedString(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const trimmed = stripUnsafeMarkup(value);
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function normalizeKeyMetrics(value: unknown): AssistantKeyMetric[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const metrics: AssistantKeyMetric[] = [];
  for (const item of value.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const label = asTrimmedString(record.label, 80);
    const metricValue = asTrimmedString(record.value, 80);
    if (!label || !metricValue) continue;
    metrics.push({ label, value: metricValue });
  }
  return metrics.length > 0 ? metrics : undefined;
}

function normalizeSources(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set<string>(ASSISTANT_SOURCE_WHITELIST);
  const sources = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => allowed.has(item))
    .slice(0, 8);
  return sources.length > 0 ? Array.from(new Set(sources)) : undefined;
}

function looksLikeSecretLeak(answer: string) {
  return /BETTER_AUTH_SECRET|OPENAI_API_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|MONGODB_URI|sk-[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]+/i.test(
    answer,
  );
}

/** Validates/normalizes model JSON into a safe client response. */
export function normalizeAssistantResponse(raw: unknown): AssistantResponse {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Assistant response is malformed");
  }

  const record = raw as Record<string, unknown>;
  const answer = asTrimmedString(record.answer, ASSISTANT_ANSWER_MAX_LENGTH);
  if (!answer) throw new Error("Assistant response is missing an answer");
  if (looksLikeSecretLeak(answer)) {
    throw new Error("Assistant response failed safety checks");
  }

  const period = asTrimmedString(record.period, 120) ?? undefined;
  const keyMetrics = normalizeKeyMetrics(record.keyMetrics);
  const sources = normalizeSources(record.sources);

  return {
    answer,
    ...(period ? { period } : {}),
    ...(keyMetrics ? { keyMetrics } : {}),
    ...(sources ? { sources } : {}),
  };
}
