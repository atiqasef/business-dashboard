import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { connectMongo } from "@/lib/db";
import { toNextJsHandler } from "better-auth/next-js";

const betterAuthHandler = toNextJsHandler(auth);

function withMongoConnection(handler: (request: Request) => Promise<Response>) {
	return async (request: Request) => {
		try {
			await connectMongo();
			return handler(request);
		} catch {
			return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
		}
	};
}

export const GET = withMongoConnection(betterAuthHandler.GET);
export const POST = withMongoConnection(betterAuthHandler.POST);
export const PUT = withMongoConnection(betterAuthHandler.PUT);
export const PATCH = withMongoConnection(betterAuthHandler.PATCH);
export const DELETE = withMongoConnection(betterAuthHandler.DELETE);
