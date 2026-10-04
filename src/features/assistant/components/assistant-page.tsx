"use client";

import { useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";

const SUGGESTED_QUESTIONS = [
  "How is my business doing this month?",
  "Compare revenue with last month.",
  "Which products are performing best?",
  "Who has overdue invoices?",
  "What needs my attention?",
];

type AssistantKeyMetric = {
  label: string;
  value: string;
};

type AssistantResult = {
  answer: string;
  keyMetrics?: AssistantKeyMetric[];
  period?: string;
  sources?: string[];
};

export function AssistantPage({
  configured,
  readOnlyDemo,
}: {
  configured: boolean;
  readOnlyDemo: boolean;
}) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AssistantResult | null>(null);

  async function submitQuestion(nextQuestion: string) {
    const trimmed = nextQuestion.trim();
    if (!trimmed || loading) return;

    setQuestion(trimmed);
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        data?: AssistantResult;
        error?: string;
      };

      if (!response.ok) {
        setResult(null);
        setError(payload.error || "Unable to get an answer right now.");
        return;
      }

      setResult(payload.data ?? null);
    } catch {
      setResult(null);
      setError("Unable to reach the assistant. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submitQuestion(question);
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">AI Assistant</h1>
          <Badge tone="neutral">Read-only</Badge>
          {readOnlyDemo ? <Badge tone="warning">Demo</Badge> : null}
        </div>
        <p className="max-w-2xl text-sm text-[var(--muted)]">
          Ask natural-language questions about your sales, invoices, payments, products, and customers.
          Answers use your authenticated business data only and cannot change anything.
        </p>
      </header>

      {!configured ? (
        <Card className="border-dashed">
          <CardHeading>
            <div>
              <h2 className="text-base font-semibold">AI assistant is not configured</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Add a server-only{" "}
                <code className="rounded bg-[var(--surface-soft)] px-1.5 py-0.5 text-xs">OPENAI_API_KEY</code>{" "}
                environment variable to enable the assistant. The rest of the dashboard continues to work normally.
              </p>
            </div>
          </CardHeading>
        </Card>
      ) : null}

      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          <label htmlFor="assistant-question" className="block text-sm font-medium text-[var(--ink)]">
            Your question
          </label>
          <textarea
            id="assistant-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={4}
            maxLength={1000}
            placeholder="e.g. Why was revenue lower this month?"
            className="w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--ink)] outline-none ring-[var(--accent)] placeholder:text-[var(--muted)] focus:ring-2"
            disabled={loading || !configured}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[var(--muted)]">{question.trim().length}/1000</p>
            <Button type="submit" variant="primary" disabled={loading || !configured || !question.trim()}>
              <Sparkles className="size-4" aria-hidden="true" />
              {loading ? "Analyzing…" : "Ask assistant"}
            </Button>
          </div>
        </form>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-[var(--ink)]">Suggested questions</h2>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_QUESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={loading || !configured}
              onClick={() => void submitQuestion(suggestion)}
              className="rounded-full border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-1.5 text-left text-xs font-medium text-[var(--ink)] transition hover:bg-[var(--surface-soft)] disabled:opacity-50"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </section>

      {error ? (
        <Card className="border-[var(--warning)]/40 bg-[var(--warning-soft)]">
          <p className="text-sm text-[var(--warning)]">{error}</p>
        </Card>
      ) : null}

      {loading ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">Reviewing your business analytics…</p>
        </Card>
      ) : null}

      {!loading && !error && !result ? (
        <Card className="border-dashed">
          <CardHeading>
            <div>
              <h2 className="text-base font-semibold">Ask a question to get started</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Try a suggested prompt, or ask about revenue, products, overdue invoices, or what needs attention this
                week.
              </p>
            </div>
          </CardHeading>
        </Card>
      ) : null}

      {result ? (
        <Card>
          <CardHeading>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">Answer</h2>
              <Badge tone="neutral">Based on your business data</Badge>
              {result.period ? <Badge tone="accent">{result.period}</Badge> : null}
            </div>
          </CardHeading>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-[var(--ink)]">{result.answer}</p>

          {result.keyMetrics && result.keyMetrics.length > 0 ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {result.keyMetrics.map((metric) => (
                <div
                  key={`${metric.label}-${metric.value}`}
                  className="rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3"
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{metric.label}</p>
                  <p className="mt-1 text-base font-semibold text-[var(--ink)]">{metric.value}</p>
                </div>
              ))}
            </div>
          ) : null}

          {result.sources && result.sources.length > 0 ? (
            <p className="mt-5 text-xs text-[var(--muted)]">Sources: {result.sources.join(" · ")}</p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
