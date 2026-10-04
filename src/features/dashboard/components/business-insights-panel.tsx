"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import type { BusinessInsight } from "@/server/ai/insight-types";

function severityTone(severity: BusinessInsight["severity"]) {
  if (severity === "high") return "warning" as const;
  if (severity === "medium") return "accent" as const;
  return "neutral" as const;
}

export function BusinessInsightsPanel({
  insights,
  periodLabel,
  aiConfigured,
}: {
  insights: BusinessInsight[];
  periodLabel: string;
  aiConfigured: boolean;
}) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestSummary() {
    if (loading || !aiConfigured) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/insights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        data?: { summary?: string | null; aiAvailable?: boolean };
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error || "Unable to generate an AI summary right now.");
        return;
      }
      if (!payload.data?.aiAvailable) {
        setError("AI summary is not configured.");
        return;
      }
      setSummary(payload.data.summary ?? "No executive summary was generated for the current insights.");
    } catch {
      setError("Unable to reach the assistant. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeading>
        <div className="flex w-full flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Business Insights</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Deterministic signals from your analytics · {periodLabel} (UTC). Recommendations are suggestions, not
              completed actions.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={!aiConfigured || loading || insights.length === 0}
            onClick={() => void requestSummary()}
          >
            <Sparkles className="size-4" aria-hidden="true" />
            {loading ? "Summarizing…" : "AI executive summary"}
          </Button>
        </div>
      </CardHeading>

      {!aiConfigured ? (
        <p className="mt-3 text-xs text-[var(--muted)]">
          AI summary is optional and unavailable until <code className="rounded bg-[var(--surface-soft)] px-1">OPENAI_API_KEY</code>{" "}
          is configured. Insight cards still work without AI.
        </p>
      ) : null}

      {error ? <p className="mt-3 text-sm text-[var(--warning)]">{error}</p> : null}
      {summary ? (
        <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Executive summary</p>
          <p className="mt-1 text-sm leading-6 text-[var(--ink)]">{summary}</p>
        </div>
      ) : null}

      {insights.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-soft)] px-5 py-8 text-center">
          <p className="text-sm font-semibold">No material insights right now</p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            When revenue shifts, receivables age, inventory runs low, or cancellations rise, they will appear here.
          </p>
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {insights.map((insight) => (
            <li
              key={insight.id}
              className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={severityTone(insight.severity)}>{insight.severity}</Badge>
                <p className="text-sm font-semibold text-[var(--ink)]">{insight.title}</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{insight.summary}</p>
              {insight.metrics && insight.metrics.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {insight.metrics.map((metric) => (
                    <span
                      key={`${insight.id}-${metric.label}`}
                      className="rounded-full bg-[var(--surface-soft)] px-2.5 py-1 text-xs text-[var(--ink)]"
                    >
                      {metric.label}: <strong>{metric.value}</strong>
                    </span>
                  ))}
                </div>
              ) : null}
              {insight.recommendation ? (
                <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{insight.recommendation}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
