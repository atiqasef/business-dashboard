import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { connectMongo } from "@/lib/db";
import { toNextJsHandler } from "better-auth/next-js";

const betterAuthHandler = toNextJsHandler(auth);

type AuthFailureStage = "mongodb-connection" | "better-auth-handler";

function safeErrorName(error: unknown) {
	const name = error instanceof Error ? error.name : "UnknownError";
	return /^[A-Za-z][A-Za-z0-9_.$-]{0,63}$/.test(name) ? name : "UnknownError";
}

function safeErrorCode(error: unknown) {
	if (!error || typeof error !== "object" || !("code" in error)) return undefined;

	const code = (error as { code?: unknown }).code;
	if (typeof code === "number" && Number.isFinite(code)) return code;
	if (typeof code === "string" && /^[A-Z][A-Z0-9_.:-]{0,63}$/.test(code)) return code;
	return undefined;
}

function logAuthFailure(stage: AuthFailureStage, error: unknown) {
	const errorCode = safeErrorCode(error);
	const diagnostic = stage === "mongodb-connection"
		? "MongoDB connection failed before Better Auth request handling"
		: "Better Auth request handling failed after MongoDB connection";

	console.error("[auth diagnostic]", {
		stage,
		errorName: safeErrorName(error),
		...(errorCode === undefined ? {} : { errorCode }),
		diagnostic,
	});
}

function withMongoConnection(handler: (request: Request) => Promise<Response>) {
	return async (request: Request) => {
		try {
			await connectMongo();
		} catch (error) {
			logAuthFailure("mongodb-connection", error);
			return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
		}

		try {
			return await handler(request);
		} catch (error) {
			logAuthFailure("better-auth-handler", error);
			return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
		}
	};
}

export const GET = withMongoConnection(betterAuthHandler.GET);
export const POST = withMongoConnection(betterAuthHandler.POST);
export const PUT = withMongoConnection(betterAuthHandler.PUT);
export const PATCH = withMongoConnection(betterAuthHandler.PATCH);
export const DELETE = withMongoConnection(betterAuthHandler.DELETE);
