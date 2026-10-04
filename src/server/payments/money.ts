import { normalizeMoney } from "@/server/invoices/status";

/** Application currency for Phase 13 — multi-currency remains deferred. */
export const APP_CURRENCY = "usd" as const;

/**
 * Convert a normalized USD dollar amount to Stripe's integer cents.
 * Uses normalizeMoney + Math.round to avoid floating-point drift.
 */
export function dollarsToStripeCents(amount: number): number {
  const dollars = normalizeMoney(amount);
  if (!Number.isFinite(dollars) || dollars <= 0) {
    throw new Error("amount must be greater than zero");
  }

  const cents = Math.round(dollars * 100);
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error("amount conversion produced an invalid Stripe amount");
  }

  // Guard against float residue that would disagree with two-decimal money.
  if (Math.abs(dollars * 100 - cents) > 0.001) {
    throw new Error("amount has unsupported precision");
  }

  return cents;
}

export function stripeCentsToDollars(cents: number): number {
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new Error("Stripe amount must be a positive integer");
  }
  return normalizeMoney(cents / 100);
}
