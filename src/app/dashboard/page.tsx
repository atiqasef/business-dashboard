import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { SignOutButton } from "@/features/auth/components/sign-out-button";

export default async function DashboardPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-[var(--surface)] p-6 text-[var(--ink)]">
      <div className="mx-auto max-w-6xl rounded-3xl border border-[var(--line)] bg-[var(--surface-raised)] p-6 shadow-[0_20px_45px_rgba(32,51,46,0.04)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] pb-5">
          <div>
            <p className="text-xs font-bold tracking-[0.18em] text-[var(--accent)] uppercase">Dashboard</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Welcome back</h1>
          </div>
          <SignOutButton />
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-5">
            <p className="text-sm text-[var(--muted)]">User</p>
            <p className="mt-2 text-xl font-semibold">{session.user.name || "Account owner"}</p>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-5">
            <p className="text-sm text-[var(--muted)]">Email</p>
            <p className="mt-2 text-xl font-semibold">{session.user.email}</p>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-5">
            <p className="text-sm text-[var(--muted)]">Status</p>
            <p className="mt-2 text-xl font-semibold text-[var(--positive)]">Authenticated</p>
          </div>
        </div>
      </div>
    </main>
  );
}
