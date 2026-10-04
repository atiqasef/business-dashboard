"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

export function PublicInvoicePayButton({
  token,
  canPay,
  disabledReason,
}: {
  token: string;
  canPay: boolean;
  disabledReason: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function startCheckout() {
    if (!canPay || loading) return;
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/public/invoices/${encodeURIComponent(token)}/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Body intentionally empty — amount/owner/invoice are resolved server-side from the token.
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        data?: { checkoutUrl?: string };
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error || "Unable to start online payment.");
      }

      const checkoutUrl = payload?.data?.checkoutUrl;
      if (!checkoutUrl) throw new Error("Unable to start online payment.");
      window.location.assign(checkoutUrl);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Unable to start online payment.");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <button
        type="button"
        onClick={() => void startCheckout()}
        disabled={!canPay || loading}
        title={canPay ? "Pay this invoice with Stripe Checkout" : disabledReason}
        className="inline-flex h-10 items-center justify-center rounded-xl bg-[var(--ink)] px-4 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
        {loading ? "Redirecting..." : "Pay Invoice"}
      </button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
