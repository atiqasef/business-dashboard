"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

function initialsFromName(name: string, email: string) {
  const source = name.trim() || email.trim();
  if (!source) return "A";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return source.slice(0, 1).toUpperCase();
}

export function AccountMenu({
  userName,
  userEmail,
  readOnlyDemo,
  compact = false,
}: {
  userName: string;
  userEmail: string;
  readOnlyDemo: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");

  const displayName = userName.trim() || "Account owner";
  const initials = initialsFromName(userName, userEmail);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setError("");

    try {
      const result = await authClient.signOut();
      if (result.error) {
        setError("Unable to sign out. Please try again.");
        setLoggingOut(false);
        return;
      }

      setOpen(false);
      router.push("/login");
      router.refresh();
    } catch {
      setError("Unable to sign out. Please try again.");
      setLoggingOut(false);
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <Button
        type="button"
        variant="ghost"
        className={`h-10 gap-2 px-2 ${compact ? "w-full justify-start" : ""}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="grid size-8 place-items-center rounded-full bg-[var(--accent-soft)] text-xs font-bold text-[var(--accent-strong)]">
          {initials}
        </span>
        {!compact ? <span className="hidden max-w-[10rem] truncate text-sm font-semibold lg:block">{displayName}</span> : null}
        {compact ? (
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-xs font-semibold">{displayName}</span>
            <span className="mt-0.5 block truncate text-[11px] text-[var(--muted)]">
              {readOnlyDemo ? "Read-only demo" : userEmail || "Signed in"}
            </span>
          </span>
        ) : null}
        <ChevronDown className={`size-4 text-[var(--muted)] ${compact ? "ml-auto" : "hidden sm:block"}`} aria-hidden="true" />
      </Button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Account menu"
          className={`absolute z-50 w-64 rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] p-2 shadow-xl ${
            compact ? "bottom-14 left-0 right-0 w-auto" : "right-0 top-12"
          }`}
        >
          <div className="rounded-lg px-3 py-2">
            <p className="truncate text-sm font-semibold text-[var(--ink)]">{displayName}</p>
            {userEmail ? <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{userEmail}</p> : null}
            {readOnlyDemo ? <Badge tone="accent" className="mt-2">Read-only demo</Badge> : null}
          </div>
          <div className="my-1 border-t border-[var(--line)]" />
          <button
            type="button"
            role="menuitem"
            disabled={loggingOut}
            onClick={() => void handleLogout()}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-[var(--ink)] hover:bg-[var(--surface-soft)] disabled:pointer-events-none disabled:opacity-60"
          >
            {loggingOut ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <LogOut className="size-4" aria-hidden="true" />}
            {loggingOut ? "Logging out..." : "Logout"}
          </button>
          {error ? (
            <p className="px-3 py-2 text-xs text-red-600" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
