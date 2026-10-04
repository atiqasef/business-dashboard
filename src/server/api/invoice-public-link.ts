import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { assertDemoWriteAllowed } from "@/server/auth/demo-access";
import {
  createOrRegeneratePublicLink,
  getPublicLinkState,
  InvoiceAccessError,
  revokePublicLink,
} from "@/server/invoices/public-access";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

function jsonData(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status, headers: NO_STORE });
}

async function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}

function sanitizeState(state: Awaited<ReturnType<typeof getPublicLinkState>>) {
  // Never expose token hashes, nonces, owner ids, or invoice ObjectIds.
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
    const state = await getPublicLinkState(session.user.id, id);
    return jsonData(sanitizeState(state));
  } catch (error) {
    if (error instanceof InvoiceAccessError) return errorResponse(error.message, error.status);
    return errorResponse("Unable to load public link", 500);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  const demoWriteResponse = await assertDemoWriteAllowed(session.user.id);
  if (demoWriteResponse) return demoWriteResponse;

  try {
    const { id } = await context.params;
    const state = await createOrRegeneratePublicLink(session.user.id, id);
    return jsonData({
      status: state.status,
      expiresAt: state.expiresAt,
      createdAt: state.createdAt,
      revokedAt: state.revokedAt,
      url: state.url,
    });
  } catch (error) {
    if (error instanceof InvoiceAccessError) return errorResponse(error.message, error.status);
    return errorResponse("Unable to create public link", 500);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  if (!session) return errorResponse("Authentication required", 401);

  const demoWriteResponse = await assertDemoWriteAllowed(session.user.id);
  if (demoWriteResponse) return demoWriteResponse;

  try {
    const { id } = await context.params;
    const state = await revokePublicLink(session.user.id, id);
    return jsonData(sanitizeState(state));
  } catch (error) {
    if (error instanceof InvoiceAccessError) return errorResponse(error.message, error.status);
    return errorResponse("Unable to revoke public link", 500);
  }
}
