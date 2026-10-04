import { describe, expect, it } from "vitest";
import { GET as getOnboarding, POST as completeOnboarding } from "@/server/api/onboarding";
import { getBusinessProfilesCollection } from "@/server/db/models/business-profile";
import { getOrganizationsCollection } from "@/server/db/models/organization";
import { getOnboardingStatus } from "@/server/onboarding/status";
import { demoUser, mockSession, userA, userB } from "../helpers/auth";
import { markDemoUser, seedCustomer, seedOrder, seedProduct } from "../helpers/fixtures";
import { createInvoiceFromOrder } from "../helpers/billing";
import { jsonRequest, readJson } from "../helpers/http";

async function addProfile(ownerId: string) {
  const now = new Date();
  await getBusinessProfilesCollection().insertOne({
    ownerId,
    businessName: "Ledger Studio",
    address: {},
    createdAt: now,
    updatedAt: now,
  });
}

describe("onboarding status", () => {
  it("treats an empty workspace as needing onboarding", async () => {
    const status = await getOnboardingStatus(userA.id);
    expect(status.shouldEnterOnboarding).toBe(true);
    expect(status.steps.find((step) => step.id === "businessProfile")?.complete).toBe(false);
    expect(status.steps.find((step) => step.id === "customer")?.complete).toBe(false);
    expect(status.steps.find((step) => step.id === "plan")?.complete).toBe(true);
    expect(status.complete).toBe(false);
  });

  it("marks profile, customer, product, order, and invoice from server data", async () => {
    await addProfile(userA.id);
    let status = await getOnboardingStatus(userA.id);
    expect(status.steps.find((step) => step.id === "businessProfile")?.complete).toBe(true);
    expect(status.shouldEnterOnboarding).toBe(true);

    const customer = await seedCustomer(userA.id);
    status = await getOnboardingStatus(userA.id);
    expect(status.steps.find((step) => step.id === "customer")?.complete).toBe(true);
    expect(status.shouldEnterOnboarding).toBe(false);

    const product = await seedProduct(userA.id);
    status = await getOnboardingStatus(userA.id);
    expect(status.steps.find((step) => step.id === "product")?.complete).toBe(true);

    const order = await seedOrder(userA.id, customer._id, product._id);
    status = await getOnboardingStatus(userA.id);
    expect(status.steps.find((step) => step.id === "order")?.complete).toBe(true);

    await createInvoiceFromOrder(userA, order.id, { tax: 0 });
    status = await getOnboardingStatus(userA.id);
    expect(status.steps.find((step) => step.id === "invoice")?.complete).toBe(true);
    expect(status.complete).toBe(true);
    expect(status.shouldEnterOnboarding).toBe(false);
    expect(status.showDashboardPrompt).toBe(false);

    const again = await getOnboardingStatus(userA.id);
    const stored = await getOrganizationsCollection().find({ ownerUserId: userA.id }).toArray();
    expect(stored).toHaveLength(1);
    expect(again.completedAt).toBe(status.completedAt);
  });

  it("does not force an existing workspace that already has records", async () => {
    await seedCustomer(userA.id, { firstName: "Existing" });
    const status = await getOnboardingStatus(userA.id);
    expect(status.shouldEnterOnboarding).toBe(false);
    expect(status.showDashboardPrompt).toBe(true);
  });

  it("rejects unauthenticated access and ignores browser scope", async () => {
    mockSession(null);
    expect((await getOnboarding(jsonRequest("GET", "http://localhost/api/onboarding"))).status).toBe(401);

    await seedCustomer(userA.id, { firstName: "OnlyA" });
    await seedCustomer(userB.id, { firstName: "OnlyB" });
    mockSession(userA);
    const response = await getOnboarding(
      jsonRequest("GET", "http://localhost/api/onboarding?ownerId=user-b&organizationId=x&planId=business"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const payload = await readJson(response);
    const data = payload?.data as { plan: { id: string }; steps: Array<{ id: string; complete: boolean }> };
    expect(data.plan.id).toBe("free");
    expect(data.steps.find((step) => step.id === "customer")?.complete).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("OnlyB");
    expect(payload?.destination).toBe("/");
  });

  it("does not let the browser mark onboarding complete or change plan", async () => {
    mockSession(userA);
    const response = await completeOnboarding(
      jsonRequest("POST", "http://localhost/api/onboarding", {
        ownerId: userB.id,
        organizationId: "foreign",
        planId: "business",
        complete: true,
      }),
    );
    expect(response.status).toBe(200);
    const payload = await readJson(response);
    expect((payload?.data as { complete: boolean }).complete).toBe(false);
    const org = await getOrganizationsCollection().findOne({ ownerUserId: userA.id });
    expect(org?.planId).toBe("free");
    expect(org?.onboarding?.completedAt).toBeUndefined();
  });

  it("blocks demo onboarding mutation", async () => {
    await markDemoUser();
    mockSession(demoUser);
    const response = await completeOnboarding(jsonRequest("POST", "http://localhost/api/onboarding", { complete: true }));
    expect(response.status).toBe(403);
    const status = await getOnboardingStatus(demoUser.id);
    expect(status.readOnlyDemo).toBe(true);
    expect(status.shouldEnterOnboarding).toBe(false);
  });
});
