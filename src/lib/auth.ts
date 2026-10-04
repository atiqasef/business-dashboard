import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { db } from "@/lib/db";
import { DEMO_EMAIL } from "@/server/demo/constants";

function resolveAuthSecret() {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (secret) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET must be set in production");
  }

  return "development-secret-change-me";
}

export const auth = betterAuth({
  database: mongodbAdapter(db, {
    usePlural: false,
    transaction: false,
  }),
  secret: resolveAuthSecret(),
  baseURL: process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  trustedOrigins: [process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"],
  // Admin plugin is required for server-side demo provisioning (`auth.api.createUser`).
  // Only users with role "admin" can call admin HTTP APIs; normal registration stays "user".
  plugins: [admin({ defaultRole: "user", adminRoles: ["admin"] }), nextCookies()],
  databaseHooks: {
    user: {
      create: {
        before: async (user, context) => {
          if (user.email.toLowerCase() !== DEMO_EMAIL) return;
          if (context?.path === "/admin/create-user") return;
          return false;
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
    requireEmailVerification: false,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
});
