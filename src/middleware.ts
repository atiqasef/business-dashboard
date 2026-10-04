import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const publicRoutes = new Set(["/login", "/register"]);

function hasSessionCookie(request: NextRequest) {
  return Boolean(
    request.cookies.get("__Secure-better-auth.session_token") ||
      request.cookies.get("better-auth.session_token") ||
      request.cookies.get("session_token"),
  );
}

function isPublicInvoicePath(pathname: string) {
  // Customer-facing invoice page — authorized by bearer token in the path, not session.
  return pathname === "/invoice" || pathname.startsWith("/invoice/");
}

function isPublicCustomerPortalPath(pathname: string) {
  // Customer invoice history portal — authorized by portal bearer token, not session.
  return pathname === "/portal" || pathname.startsWith("/portal/");
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/_next") || pathname.startsWith("/api") || pathname.includes(".")) {
    return NextResponse.next();
  }

  if (publicRoutes.has(pathname) || isPublicInvoicePath(pathname) || isPublicCustomerPortalPath(pathname)) {
    return NextResponse.next();
  }

  if (!hasSessionCookie(request)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
