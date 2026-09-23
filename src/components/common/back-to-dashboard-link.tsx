import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export function BackToDashboardLink({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="Back to dashboard"
      className={`inline-flex items-center gap-2 rounded-xl border border-[var(--line-strong)] bg-[var(--surface-raised)] px-3.5 py-2 text-sm font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--surface-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${className}`}
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      <span>Back to Dashboard</span>
    </Link>
  );
}
