"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { parseCookieHeader } from "@/lib/cookies";

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
      redirect("/dashboard");
    }

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      errors: {
        form: error?.message || "Registration failed. Please try again.",
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

  try {
    const result = await auth.api.signInEmail({
      body: {
        email,
        password,
      },
      headers: await parseCookieHeader(),
    });

    if ("user" in result) {
      redirect("/dashboard");
    }

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      errors: { form: error?.message || "Login failed. Please try again." },
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
