import { NextResponse } from "next/server";
import { CustomerPortalAccessError, listPortalInvoices } from "@/server/portal/access";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Paginated customer portal invoice list — authorized solely by portal bearer token. */
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const url = new URL(request.url);
    const result = await listPortalInvoices(token, {
      page: url.searchParams.get("page"),
      pageSize: url.searchParams.get("pageSize"),
      status: url.searchParams.get("status"),
      search: url.searchParams.get("search"),
      sort: url.searchParams.get("sort"),
    });

    return NextResponse.json(
      {
        data: result.data,
        summary: result.summary,
        pagination: result.pagination,
        filters: result.filters,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof CustomerPortalAccessError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse("Unable to load portal", 500);
  }
}
