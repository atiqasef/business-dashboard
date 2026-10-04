import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getBusinessProfileApi, PATCH as patchBusinessProfileApi } from "@/server/api/business-profile";
import { GET as downloadInvoicePdf } from "@/server/api/invoice-pdf";
import { POST as emailInvoice } from "@/server/api/invoice-email";
import { getBusinessProfilesCollection } from "@/server/db/models/business-profile";
import { sendEmail } from "@/server/email/send-email";
import { getBusinessProfile, upsertBusinessProfile } from "@/server/settings/business-profile";
import { createInvoiceFromOrder } from "../helpers/billing";
import { demoUser, mockSession, userA, userB } from "../helpers/auth";
import { markDemoUser, seedCustomer, seedOrder, seedProduct } from "../helpers/fixtures";
import { jsonRequest, params, readJson } from "../helpers/http";

vi.mock("@/server/email/send-email", () => ({
  sendEmail: vi.fn(),
}));

async function saveProfile(userId: typeof userA, body: Record<string, unknown>) {
  mockSession(userId);
  return patchBusinessProfileApi(
    jsonRequest("PATCH", "http://localhost/api/settings/business-profile", body),
  );
}

describe("business profile authorization", () => {
  it("rejects unauthenticated GET and PATCH", async () => {
    mockSession(null);
    const getResponse = await getBusinessProfileApi(jsonRequest("GET", "http://localhost/api/settings/business-profile"));
    const patchResponse = await patchBusinessProfileApi(
      jsonRequest("PATCH", "http://localhost/api/settings/business-profile", { businessName: "Acme" }),
    );

    expect(getResponse.status).toBe(401);
    expect(await readJson(getResponse)).toEqual({ error: "Authentication required" });
    expect(patchResponse.status).toBe(401);
    expect(await readJson(patchResponse)).toEqual({ error: "Authentication required" });
  });

  it("lets an owner read and update only their own profile", async () => {
    mockSession(userA);
    const empty = await getBusinessProfileApi(jsonRequest("GET", "http://localhost/api/settings/business-profile"));
    const emptyBody = await readJson(empty);
    expect(empty.status).toBe(200);
    expect(emptyBody?.data).toMatchObject({ exists: false, businessName: "" });

    const created = await saveProfile(userA, {
      businessName: "Harbor Goods",
      email: "hello@harbor.test",
      ownerId: userB.id,
      _id: "000000000000000000000099",
      createdAt: "2000-01-01T00:00:00.000Z",
      updatedAt: "2000-01-01T00:00:00.000Z",
    });
    const createdBody = await readJson(created);
    expect(created.status).toBe(200);
    expect(createdBody?.data).toMatchObject({
      exists: true,
      businessName: "Harbor Goods",
      email: "hello@harbor.test",
    });

    const stored = await getBusinessProfilesCollection().findOne({ ownerId: userA.id });
    expect(stored?.ownerId).toBe(userA.id);
    expect(stored?.createdAt.toISOString()).not.toBe("2000-01-01T00:00:00.000Z");

    mockSession(userB);
    const otherGet = await getBusinessProfileApi(jsonRequest("GET", "http://localhost/api/settings/business-profile"));
    const otherBody = await readJson(otherGet);
    expect(otherGet.status).toBe(200);
    expect(otherBody?.data).toMatchObject({ exists: false, businessName: "" });

    const otherPatch = await saveProfile(userB, { businessName: "Should Not Overwrite" });
    expect(otherPatch.status).toBe(200);
    expect(await getBusinessProfilesCollection().countDocuments({ ownerId: userA.id })).toBe(1);
    expect((await getBusinessProfilesCollection().findOne({ ownerId: userA.id }))?.businessName).toBe("Harbor Goods");
    expect(await getBusinessProfilesCollection().countDocuments({ ownerId: userB.id })).toBe(1);
  });
});

describe("business profile validation", () => {
  it("rejects missing businessName and invalid fields", async () => {
    mockSession(userA);

    const missing = await patchBusinessProfileApi(
      jsonRequest("PATCH", "http://localhost/api/settings/business-profile", { email: "a@b.com" }),
    );
    expect(missing.status).toBe(400);
    expect(await readJson(missing)).toEqual({ error: "businessName is required" });

    const badEmail = await saveProfile(userA, { businessName: "Acme", email: "not-an-email" });
    expect(badEmail.status).toBe(400);
    expect(await readJson(badEmail)).toEqual({ error: "email is invalid" });

    const badWebsite = await saveProfile(userA, { businessName: "Acme", website: "http://insecure.example" });
    expect(badWebsite.status).toBe(400);
    expect((await readJson(badWebsite))?.error).toContain("https");

    const oversized = await saveProfile(userA, { businessName: "A".repeat(121) });
    expect(oversized.status).toBe(400);
    expect(await readJson(oversized)).toEqual({ error: "businessName is too long" });

    const malformed = await patchBusinessProfileApi(
      new Request("http://localhost/api/settings/business-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    );
    expect(malformed.status).toBe(400);
  });
});

describe("business profile persistence", () => {
  it("creates on first save and updates the same owner profile on second save", async () => {
    const first = await saveProfile(userA, {
      businessName: "First Name Co",
      phone: "+1 555 0100",
      address: { city: "Austin", country: "USA" },
    });
    const firstBody = await readJson(first);
    expect(first.status).toBe(200);
    const firstId = (firstBody?.data as { id: string }).id;

    const second = await saveProfile(userA, {
      businessName: "Second Name Co",
      website: "https://second.example",
      invoiceNotes: "Pay within 14 days.",
    });
    const secondBody = await readJson(second);
    expect(second.status).toBe(200);
    expect((secondBody?.data as { id: string }).id).toBe(firstId);
    expect(secondBody?.data).toMatchObject({
      businessName: "Second Name Co",
      website: "https://second.example/",
      invoiceNotes: "Pay within 14 days.",
      phone: null,
    });

    expect(await getBusinessProfilesCollection().countDocuments({ ownerId: userA.id })).toBe(1);

    const loaded = await getBusinessProfile(userA.id);
    expect(loaded.businessName).toBe("Second Name Co");
  });
});

describe("business profile demo behavior", () => {
  it("allows demo GET and rejects demo PATCH", async () => {
    await markDemoUser();
    await upsertBusinessProfile(demoUser.id, {
      businessName: "Demo Shop",
      email: "shop@demo.test",
    });

    mockSession(demoUser);
    const getResponse = await getBusinessProfileApi(jsonRequest("GET", "http://localhost/api/settings/business-profile"));
    const getBody = await readJson(getResponse);
    expect(getResponse.status).toBe(200);
    expect(getBody?.data).toMatchObject({ businessName: "Demo Shop", exists: true });

    const patchResponse = await patchBusinessProfileApi(
      jsonRequest("PATCH", "http://localhost/api/settings/business-profile", {
        businessName: "Hacked Demo",
        ownerId: userA.id,
      }),
    );
    expect(patchResponse.status).toBe(403);
    expect(await readJson(patchResponse)).toEqual({ error: "Demo account is read-only" });
    expect((await getBusinessProfilesCollection().findOne({ ownerId: demoUser.id }))?.businessName).toBe("Demo Shop");
  });
});

describe("business profile invoice integrations", () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockReset();
    vi.mocked(sendEmail).mockResolvedValue({ id: "email_profile_1" });
  });

  it("generates invoice PDFs with default branding and with a business profile", async () => {
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id, { price: 30 });
    const order = await seedOrder(userA.id, customer._id, product._id);
    const invoice = await createInvoiceFromOrder(userA, order.id);
    const invoiceId = String(invoice.data?.id);

    mockSession(userA);
    const withoutProfile = await downloadInvoicePdf(
      jsonRequest("GET", `http://localhost/api/invoices/${invoiceId}/pdf`),
      params(invoiceId),
    );
    expect(withoutProfile.status).toBe(200);
    const defaultPdf = Buffer.from(await withoutProfile.arrayBuffer());
    expect(defaultPdf.subarray(0, 4).toString("utf8")).toBe("%PDF");
    // PDFKit stores Author in cleartext metadata even when page streams are compressed.
    expect(defaultPdf.toString("latin1")).toContain("(Ledger)");

    await upsertBusinessProfile(userA.id, {
      businessName: "Northwind Trading",
      email: "billing@northwind.test",
      phone: "+1 555 2000",
      website: "https://northwind.test",
      address: { street: "12 Market St", city: "Seattle", country: "USA" },
      invoiceNotes: "Wire transfers preferred.",
    });

    const withProfile = await downloadInvoicePdf(
      jsonRequest("GET", `http://localhost/api/invoices/${invoiceId}/pdf`),
      params(invoiceId),
    );
    expect(withProfile.status).toBe(200);
    const brandedPdf = Buffer.from(await withProfile.arrayBuffer());
    expect(brandedPdf.subarray(0, 4).toString("utf8")).toBe("%PDF");
    expect(brandedPdf.toString("latin1")).toContain("(Northwind Trading)");
  });

  it("uses business profile branding in email content without trusting client sender fields", async () => {
    const customer = await seedCustomer(userA.id, { email: "buyer@example.test", firstName: "Buyer" });
    const product = await seedProduct(userA.id, { price: 40 });
    const order = await seedOrder(userA.id, customer._id, product._id);
    const invoice = await createInvoiceFromOrder(userA, order.id);
    const invoiceId = String(invoice.data?.id);

    await upsertBusinessProfile(userA.id, {
      businessName: "Cedar & Co",
      email: "office@cedar.test",
      invoiceNotes: "Thank you for choosing Cedar.",
    });

    mockSession(userA);
    const response = await emailInvoice(
      jsonRequest("POST", `http://localhost/api/invoices/${invoiceId}/email`, {
        from: "spoof@evil.test",
        EMAIL_FROM: "spoof@evil.test",
        to: "other@example.test",
      }),
      params(invoiceId),
    );

    expect(response.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(sendEmail).mock.calls[0]?.[0];
    expect(payload?.to).toBe("buyer@example.test");
    expect(payload?.subject).toContain("Cedar & Co");
    expect(payload?.html).toContain("Cedar &amp; Co");
    expect(payload?.html).toContain("office@cedar.test");
    expect(payload?.text).toContain("Cedar & Co");
    expect(payload?.text).toContain("Thank you for choosing Cedar.");
    expect(payload?.fromDisplayName).toBe("Cedar & Co");
  });
});
