/**
 * Canonical public origin for customer-facing links (invoice portal, emails).
 * Prefer NEXT_PUBLIC_APP_URL; fall back to BETTER_AUTH_URL.
 * Never hardcode localhost in production call sites — callers use this helper.
 */
export function getCanonicalAppUrl() {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.BETTER_AUTH_URL?.trim() || "";

  if (!configured) {
    throw new Error("NEXT_PUBLIC_APP_URL (or BETTER_AUTH_URL) must be configured");
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("NEXT_PUBLIC_APP_URL is invalid");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_APP_URL must be an http(s) URL");
  }

  // Strip trailing slash for stable joins.
  return url.origin;
}

export function buildPublicInvoiceUrl(token: string) {
  return `${getCanonicalAppUrl()}/invoice/${token}`;
}

export function buildPublicInvoicePdfUrl(token: string) {
  return `${getCanonicalAppUrl()}/invoice/${token}/pdf`;
}

export function buildCustomerPortalUrl(token: string) {
  return `${getCanonicalAppUrl()}/portal/${token}`;
}

export function buildCustomerPortalInvoiceUrl(token: string, invoiceNumber: string) {
  return `${getCanonicalAppUrl()}/portal/${token}/invoice/${encodeURIComponent(invoiceNumber)}`;
}
