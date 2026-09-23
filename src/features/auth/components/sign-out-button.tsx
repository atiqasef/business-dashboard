"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSignOut() {
    if (loading) return;

    setLoading(true);
    setError("");

    try {
      const result = await authClient.signOut();

      if (result.error) {
        setError("Unable to sign out. Please try again.");
        setLoading(false);
        return;
      }

      router.push("/login");
      router.refresh();
    } catch {
      setError("Unable to sign out. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={handleSignOut}
        disabled={loading}
        className="rounded-xl bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--ink-strong)] disabled:pointer-events-none disabled:opacity-60"
      >
        {loading ? "Signing out..." : "Sign out"}
      </button>
      {error ? <p className="text-xs text-red-600" role="alert">{error}</p> : null}
    </div>
  );
}