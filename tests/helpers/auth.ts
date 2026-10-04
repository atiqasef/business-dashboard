import { vi } from "vitest";
import { auth } from "@/lib/auth";

export type TestUser = {
  id: string;
  email?: string;
  name?: string;
};

export function mockSession(user: TestUser | null) {
  if (!user) {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    return;
  }

  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: {
      id: user.id,
      email: user.email ?? `${user.id}@example.test`,
      name: user.name ?? "Test User",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    session: {
      id: `session-${user.id}`,
      userId: user.id,
      token: `token-${user.id}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    },
  } as never);
}

export const userA: TestUser = { id: "user-a", email: "user-a@example.test", name: "User A" };
export const userB: TestUser = { id: "user-b", email: "user-b@example.test", name: "User B" };
export const demoUser: TestUser = {
  id: "demo-user",
  email: "demo@businessdashboard.com",
  name: "Atiq",
};
