import { redirect } from "next/navigation";
import { ReportsPage } from "@/features/reports/components/reports-page";
import { getCurrentUserAccess } from "@/server/auth/session-access";
import { getReportData } from "@/server/reports/get-report-data";
import type { ReportData } from "@/server/reports/types";

type ReportsSearchParams = {
  preset?: string;
  start?: string;
  end?: string;
};

export default async function ReportsRoute({
  searchParams,
}: {
  searchParams: Promise<ReportsSearchParams>;
}) {
  const access = await getCurrentUserAccess();
  if (!access) redirect("/login");

  const params = await searchParams;
  let data: ReportData | null = null;
  let rangeError: string | null = null;

  try {
    data = await getReportData(access.session.user.id, {
      preset: params.preset,
      start: params.start,
      end: params.end,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("Invalid report preset") ||
        error.message.includes("Custom range") ||
        error.message.includes("must be YYYY-MM-DD") ||
        error.message.includes("is invalid") ||
        error.message.includes("start must be") ||
        error.message.includes("cannot exceed"))
    ) {
      rangeError = error.message;
      try {
        data = await getReportData(access.session.user.id, { preset: "last_30_days" });
      } catch {
        data = null;
      }
    } else {
      data = null;
    }
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-[1600px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
        <div className="rounded-3xl border border-[var(--line)] bg-[var(--surface-raised)] p-6 sm:p-8">
          <p className="text-xs font-bold tracking-[0.18em] text-[var(--accent)] uppercase">Reports</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">Unable to load reports</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">
            We could not load your analytics right now. Please refresh the page or try again in a moment.
          </p>
        </div>
      </main>
    );
  }

  return <ReportsPage data={data} readOnlyDemo={access.isReadOnlyDemo} rangeError={rangeError} />;
}
