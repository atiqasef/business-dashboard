"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { parseCookieHeader } from "@/lib/cookies";
import { connectMongo } from "@/lib/db";
import { isNextRedirectError } from "@/lib/redirect-error";
import { APP_HOME_PATH } from "@/lib/app-paths";
import { DEMO_EMAIL, DEMO_PASSWORD } from "@/server/demo/constants";
import { provisionDemo } from "@/server/demo/provision";

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

export async function registerUser(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const password = String(formData.get("password") || "");

  const errors: Record<string, string> = {};

  if (!name || name.length < 2) {
    errors.name = "Name must be at least 2 characters.";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Please enter a valid email address.";
  }

  if (password.length < 8) {
    errors.password = "Password must be at least 8 characters.";
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  try {
    const result = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name,
      },
      headers: await parseCookieHeader(),
    });

    if (result && "user" in result) {
      redirect(APP_HOME_PATH);
    }

    return { success: true };
  } catch (error: unknown) {
    if (isNextRedirectError(error)) throw error;
    return {
      success: false,
      errors: {
        form: getErrorMessage(error, "Registration failed. Please try again."),
      },
    };
  }
}

export async function loginUser(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  const errors: Record<string, string> = {};

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Please enter a valid email address.";
  }

  if (password.length < 8) {
    errors.password = "Password must be at least 8 characters.";
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  if (email.toLowerCase() === DEMO_EMAIL) {
    return loginDemoUser();
  }

  try {
    const result = await auth.api.signInEmail({
      body: {
        email,
        password,
      },
      headers: await parseCookieHeader(),
    });

    if ("user" in result) {
      redirect(APP_HOME_PATH);
    }

    return { success: true };
  } catch (error: unknown) {
    if (isNextRedirectError(error)) throw error;
    return {
      success: false,
      errors: { form: getErrorMessage(error, "Login failed. Please try again.") },
    };
  }
}

/**
 * Ensures the reserved demo account exists (idempotent), signs in, and lands on `/`.
 * Safe for production: only creates/updates the intentional demo resources.
 */
export async function loginDemoUser() {
  try {
    await connectMongo();
    await provisionDemo();

    const result = await auth.api.signInEmail({
      body: {
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
      },
      headers: await parseCookieHeader(),
    });

    if ("user" in result) {
      redirect(APP_HOME_PATH);
    }

    return {
      success: false as const,
      errors: { form: "Demo login failed. Please try again." },
    };
  } catch (error: unknown) {
    if (isNextRedirectError(error)) throw error;
    return {
      success: false as const,
      errors: {
        form: getErrorMessage(error, "Unable to sign in to the demo account."),
      },
    };
  }
}

export async function logoutUser() {
  try {
    await auth.api.signOut({
      headers: await parseCookieHeader(),
    });
  } catch (error) {
    console.error("Logout failed", error);
  }

  redirect("/login");
}

export async function getCurrentUser() {
  return auth.api.getSession({
    headers: await parseCookieHeader(),
  });
}
