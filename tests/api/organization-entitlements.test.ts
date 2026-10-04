import { describe, expect, it } from "vitest";
import { GET as getOrganization } from "@/server/api/organization";
import { getOrganizationsCollection } from "@/server/db/models/organization";
import { getCustomersCollection } from "@/server/db/models/customer";
import { PLANS } from "@/server/entitlements/plans";
import {
  assertFeature,
  assertWithinLimit,
  hasFeature,
  getLimit,
  getPlan,
} from "@/server/entitlements/service";
import { EntitlementError } from "@/server/entitlements/errors";
import { ensureOrganizationForUser } from "@/server/organizations/provision";
import { resolveOrganizationForUser, toPublicOrganizationResponse } from "@/server/organizations/resolve";
import { demoUser, mockSession, userA, userB } from "../helpers/auth";
import { markDemoUser, seedCustomer } from "../helpers/fixtures";
import { jsonRequest, readJson } from "../helpers/http";

describe("plan definitions", () => {
  it("resolves centralized plans and default free entitlements", () => {
    expect(getPlan("free").name).toBe("Free");
    expect(getPlan("starter").features.aiAssistant).toBe(false);
    expect(getPlan("pro").features.aiAssistant).toBe(true);
    expect(getPlan("business").limits.customers).toBeNull();
    expect(PLANS.free.features.proactiveInsights).toBe(true);
  });
});

describe("organization provisioning", () => {
  it("provisions an organization idempotently and race-safely for the session user", async () => {
    const first = await ensureOrganizationForUser(userA.id, { displayName: "Atiq Workspace" });
    const second = await ensureOrganizationForUser(userA.id, { displayName: "Ignored Name" });

    expect(first.ownerUserId).toBe(userA.id);
    expect(second._id?.toString()).toBe(first._id?.toString());
    expect(second.name).toBe(first.name);
    expect(first.planId).toBe("free");
    expect(first.status).toBe("active");

    const count = await getOrganizationsCollection().countDocuments({ ownerUserId: userA.id });
    expect(count).toBe(1);
  });

  it("keeps organizations owner-isolated", async () => {
    const orgA = await ensureOrganizationForUser(userA.id);
    const orgB = await ensureOrganizationForUser(userB.id);

    expect(orgA.ownerUserId).toBe(userA.id);
    expect(orgB.ownerUserId).toBe(userB.id);
    expect(orgA.slug).not.toBe(orgB.slug);

    const leaked = await getOrganizationsCollection().findOne({
      ownerUserId: userA.id,
      slug: orgB.slug,
    });
    expect(leaked).toBeNull();
  });

  it("provisions a read-only demo organization without plan mutation APIs", async () => {
    await markDemoUser();
    const org = await ensureOrganizationForUser(demoUser.id, { displayName: "Demo Workspace" });
    expect(org.ownerUserId).toBe(demoUser.id);
    expect(org.planId).toBe("free");

    // There is no authenticated plan-change endpoint; demo cannot escalate via body fields.
    mockSession(demoUser);
    const response = await getOrganization(
      jsonRequest("GET", "http://localhost/api/organization?planId=business&organizationId=hack"),
    );
    expect(response.status).toBe(200);
    const payload = await readJson(response);
    expect(payload).toMatchObject({
      data: { plan: { id: "free" }, status: "active" },
    });
    expect(JSON.stringify(payload)).not.toMatch(/ownerUserId|"_id"|demoUser/);
  });
});

describe("entitlements", () => {
  it("allows and denies features from centralized plan config", async () => {
    const org = await ensureOrganizationForUser(userA.id);
    expect(hasFeature(org, "aiAssistant")).toBe(true);
    assertFeature(org, "reports");

    const starterOrg = { ...org, planId: "starter" as const };
    expect(hasFeature(starterOrg, "aiAssistant")).toBe(false);
    expect(() => assertFeature(starterOrg, "aiAssistant")).toThrow(EntitlementError);
    try {
      assertFeature(starterOrg, "aiInsightSummary");
    } catch (error) {
      expect(error).toMatchObject({ code: "PLAN_FEATURE_DENIED", status: 403 });
    }
  });

  it("calculates and enforces limits using server-side counts", async () => {
    await ensureOrganizationForUser(userA.id);
    await seedCustomer(userA.id, { firstName: "One" });
    await seedCustomer(userA.id, { firstName: "Two" });

    const count = await getCustomersCollection().countDocuments({ ownerId: userA.id });
    expect(count).toBeGreaterThanOrEqual(2);
    expect(getLimit({ planId: "free" }, "customers")).toBe(PLANS.free.limits.customers);

    await expect(
      assertWithinLimit(
        { ownerUserId: userA.id, planId: "free", status: "active" },
        "customers",
      ),
    ).resolves.toMatchObject({ current: expect.any(Number), limit: PLANS.free.limits.customers });

    // starter.monthlyAiQueries = 0 and meter currently returns 0 → limit reached.
    await expect(
      assertWithinLimit(
        { ownerUserId: userA.id, planId: "starter", status: "active" },
        "monthlyAiQueries",
      ),
    ).rejects.toMatchObject({
      code: "PLAN_LIMIT_REACHED",
      details: { resource: "monthlyAiQueries", limit: 0 },
    });
  });

  it("never trusts browser plan/organization overrides on the API", async () => {
    await ensureOrganizationForUser(userA.id);
    mockSession(userA);

    const response = await getOrganization(
      jsonRequest(
        "GET",
        "http://localhost/api/organization?ownerId=user-b&organizationId=foreign&planId=business&status=suspended",
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const payload = await readJson(response);
    expect(payload).toMatchObject({
      data: {
        plan: { id: "free", name: "Free" },
        status: "active",
        billing: { subscriptionBilling: "not_implemented" },
      },
    });
    expect(JSON.stringify(payload)).not.toContain("user-b");
    expect(JSON.stringify(payload)).not.toContain("ownerUserId");
  });

  it("rejects unauthenticated organization access", async () => {
    mockSession(null);
    const response = await getOrganization(jsonRequest("GET", "http://localhost/api/organization"));
    expect(response.status).toBe(401);
  });

  it("keeps existing owner-scoped business data accessible beside organizations", async () => {
    await seedCustomer(userA.id, { firstName: "Legacy", lastName: "Owner" });
    const context = await resolveOrganizationForUser(userA.id);
    expect(context.ownerUserId).toBe(userA.id);

    const customer = await getCustomersCollection().findOne({
      ownerId: userA.id,
      firstName: "Legacy",
    });
    expect(customer).toBeTruthy();

    const publicDto = toPublicOrganizationResponse(context);
    expect(publicDto.features.reports).toBe(true);
    expect(publicDto).not.toHaveProperty("ownerUserId");
    expect(publicDto).not.toHaveProperty("_id");
  });
});
