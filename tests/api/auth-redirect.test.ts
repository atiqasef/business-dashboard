import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { APP_HOME_PATH, LEGACY_DASHBOARD_PATH } from "@/lib/app-paths";
import { DEMO_EMAIL, DEMO_PASSWORD } from "@/server/demo/constants";
import { getDemoAccountsCollection } from "@/server/db/models/demo-account";
import { getCustomersCollection } from "@/server/db/models/customer";
import { getProductsCollection } from "@/server/db/models/product";
import { getOrdersCollection } from "@/server/db/models/order";
import { provisionDemo } from "@/server/demo/provision";
import { loginDemoUser, loginUser } from "@/features/auth/actions";
import { assertDemoWriteAllowed } from "@/server/auth/demo-access";
import { demoUser, mockSession } from "../helpers/auth";
import { markDemoUser } from "../helpers/fixtures";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    const error = new Error(`NEXT_REDIRECT:${path}`);
    (error as Error & { digest: string }).digest = `NEXT_REDIRECT;replace;${path};303;`;
    throw error;
  }),
}));

vi.mock("@/lib/cookies", () => ({
  parseCookieHeader: vi.fn(async () => new Headers()),
}));

describe("post-auth redirect paths", () => {
  it("uses the live dashboard root as the authenticated home path", () => {
    expect(APP_HOME_PATH).toBe("/");
    expect(LEGACY_DASHBOARD_PATH).toBe("/dashboard");
  });

  it("redirects successful password login to /", async () => {
    vi.mocked(auth.api.signInEmail).mockResolvedValue({
      user: { id: "user-a", email: "a@example.test", name: "A" },
    } as never);

    const formData = new FormData();
    formData.set("email", "a@example.test");
    formData.set("password", "password123");

    await expect(loginUser(formData)).rejects.toThrow("NEXT_REDIRECT:/");
    expect(vi.mocked(redirect)).toHaveBeenCalledWith("/");
  });
});

describe("demo account provisioning and login", () => {
  beforeEach(() => {
    vi.mocked(auth.api.createUser).mockImplementation(async () => {
      const { db } = await import("@/lib/db");
      const users = db.collection("user");
      const existing = await users.findOne({ email: DEMO_EMAIL });
      if (!existing) {
        await users.insertOne({ id: "demo-user", email: DEMO_EMAIL, name: "Atiq" });
      }
      return { user: { id: "demo-user", email: DEMO_EMAIL, name: "Atiq" } } as never;
    });
    vi.mocked(auth.api.signInEmail).mockResolvedValue({
      user: { id: "demo-user", email: DEMO_EMAIL, name: "Atiq" },
    } as never);
  });

  it("provisions the demo user and seed data idempotently", async () => {
    await provisionDemo();
    await provisionDemo();

    expect(await getDemoAccountsCollection().countDocuments({ userId: "demo-user", role: "read-only-demo" })).toBe(1);
    expect(await getCustomersCollection().countDocuments({ ownerId: "demo-user" })).toBe(4);
    expect(await getProductsCollection().countDocuments({ ownerId: "demo-user" })).toBe(4);
    expect(await getOrdersCollection().countDocuments({ ownerId: "demo-user" })).toBe(3);
    expect(auth.api.createUser).toHaveBeenCalledTimes(1);
  });

  it("repairs a missing demoAccounts marker for an existing demo email user", async () => {
    const users = (await import("@/lib/db")).db.collection("user");
    await users.insertOne({ id: "demo-user", email: DEMO_EMAIL, name: "Atiq" });

    await provisionDemo();

    expect(await getDemoAccountsCollection().countDocuments({ userId: "demo-user", role: "read-only-demo" })).toBe(1);
    expect(auth.api.createUser).not.toHaveBeenCalled();
  });

  it("signs the demo user in and redirects to /", async () => {
    await expect(loginDemoUser()).rejects.toThrow("NEXT_REDIRECT:/");

    expect(auth.api.signInEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
      }),
    );
    expect(vi.mocked(redirect)).toHaveBeenCalledWith("/");
    expect(await getDemoAccountsCollection().countDocuments({ userId: "demo-user" })).toBe(1);
  });

  it("keeps demo write protection after provisioning", async () => {
    await provisionDemo();
    mockSession(demoUser);
    await markDemoUser(demoUser.id);

    const blocked = await assertDemoWriteAllowed(demoUser.id);
    expect(blocked?.status).toBe(403);
  });
});
