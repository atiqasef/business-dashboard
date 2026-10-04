import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { assertDemoWriteAllowed } from "@/server/auth/demo-access";
import {
  createOrRegeneratePortalLink,
  CustomerPortalAccessError,
  getPortalLinkStateForInvoice,
  revokePortalLinkForInvoice,
} from "@/server/portal/access";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}

function sanitizeState(state: Awaited<ReturnType<typeof getPortalLinkStateForInvoice>>) {
  return {
    status: state.status,
    expiresAt: state.expiresAt,
    createdAt: state.createdAt,
    revokedAt: state.revokedAt,
    ...(state.url ? { url: state.url } : {}),
  };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  try {
    const { id } = await context.params;
    const state = await getPortalLinkStateForInvoice(session.user.id, id);
    return NextResponse.json({ data: sanitizeState(state) });
  } catch (error) {
    if (error instanceof CustomerPortalAccessError) return errorResponse(error.message, error.status);
    return errorResponse("Unable to load portal link", 500);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  const demoWriteResponse = await assertDemoWriteAllowed(session.user.id);
  if (demoWriteResponse) return demoWriteResponse;

  try {
    const { id } = await context.params;
    const state = await createOrRegeneratePortalLink(session.user.id, id);
    return NextResponse.json({
      data: {
        status: state.status,
        expiresAt: state.expiresAt,
        createdAt: state.createdAt,
        revokedAt: state.revokedAt,
        url: state.url,
      },
    });
  } catch (error) {
    if (error instanceof CustomerPortalAccessError) return errorResponse(error.message, error.status);
    return errorResponse("Unable to create portal link", 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  const demoWriteResponse = await assertDemoWriteAllowed(session.user.id);
  if (demoWriteResponse) return demoWriteResponse;

  try {
    const { id } = await context.params;
    const state = await revokePortalLinkForInvoice(session.user.id, id);
    return NextResponse.json({ data: sanitizeState(state) });
  } catch (error) {
    if (error instanceof CustomerPortalAccessError) return errorResponse(error.message, error.status);
    return errorResponse("Unable to revoke portal link", 500);
  }
}
