import type { Metadata } from "next";
import { CustomerPortalInvalidView, CustomerPortalPage } from "@/features/portal/components/customer-portal-page";
import { CustomerPortalAccessError, listPortalInvoices } from "@/server/portal/access";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Customer portal",
    robots: { index: false, follow: false },
  };
}

export default async function CustomerPortalRoute({ params, searchParams }: PageProps) {
  const { token } = await params;
  const query = await searchParams;

  let result: Awaited<ReturnType<typeof listPortalInvoices>> | null = null;
  let accessDenied = false;
  try {
    result = await listPortalInvoices(token, {
      page: first(query.page),
      pageSize: first(query.pageSize),
      status: first(query.status),
      search: first(query.search),
      sort: first(query.sort),
    });
  } catch (error) {
    if (error instanceof CustomerPortalAccessError) {
      accessDenied = true;
    } else {
      throw error;
    }
  }

  if (accessDenied || !result) {
    return <CustomerPortalInvalidView />;
  }

  return (
    <CustomerPortalPage
      token={token}
      summary={result.summary}
      invoices={result.data}
      pagination={result.pagination}
      filters={result.filters}
    />
  );
}
