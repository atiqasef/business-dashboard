import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const publicRoutes = ["/login", "/register", "/"]; 

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  const path = url.pathname;
  const isPublicRoute = publicRoutes.includes(path);

  if (path.startsWith("/_next") || path.startsWith("/api") || path.includes(".")) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get("__Secure-better-auth.session_token") || request.cookies.get("better-auth.session_token") || request.cookies.get("session_token");

  if (!sessionCookie && !isPublicRoute && path !== "/") {
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/((?!api|_next/static|_next/image|favicon.ico|login|register|customers).*)",
  ],
};
