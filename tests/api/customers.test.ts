import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { GET as listCustomers, POST as createCustomer } from "@/server/api/customers";
import { GET as getCustomer, PATCH as patchCustomer, DELETE as deleteCustomer } from "@/app/api/customers/[id]/route";
import { getCustomersCollection } from "@/server/db/models/customer";
import { mockSession, userA } from "../helpers/auth";
import { seedCustomer } from "../helpers/fixtures";
import { jsonRequest, params, readJson } from "../helpers/http";

describe("customer API", () => {
  it("lists, searches, filters, and paginates customers for the authenticated owner", async () => {
    mockSession(userA);
    await seedCustomer(userA.id, { firstName: "Maya", lastName: "Chen", email: "maya@example.test", status: "active", company: "Northstar" });
    await seedCustomer(userA.id, { firstName: "Leon", lastName: "Okafor", email: "leon@example.test", status: "inactive", company: "Brightline" });
    await seedCustomer(userA.id, { firstName: "Priya", lastName: "Nair", email: "priya@example.test", status: "active", company: "Juniper" });

    const list = await readJson(await listCustomers(jsonRequest("GET", "http://localhost/api/customers?page=1&pageSize=2")));
    expect((list?.data as unknown[]).length).toBe(2);
    expect(list?.pagination).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });

    const search = await readJson(await listCustomers(jsonRequest("GET", "http://localhost/api/customers?search=Northstar")));
    expect((search?.data as Array<{ firstName: string }>).map((item) => item.firstName)).toEqual(["Maya"]);

    const filtered = await readJson(await listCustomers(jsonRequest("GET", "http://localhost/api/customers?status=inactive")));
    expect((filtered?.data as Array<{ firstName: string }>).map((item) => item.firstName)).toEqual(["Leon"]);
  });

  it("creates, updates, and deletes a customer", async () => {
    mockSession(userA);

    const createResponse = await createCustomer(
      jsonRequest("POST", "http://localhost/api/customers", {
        firstName: "Casey",
        lastName: "Ng",
        email: "casey.ng@example.test",
        status: "active",
      }),
    );
    const created = await readJson(createResponse);
    const id = (created?.data as { id: string }).id;

    expect(createResponse.status).toBe(201);

    const getResponse = await getCustomer(jsonRequest("GET", `http://localhost/api/customers/${id}`), params(id));
    expect(getResponse.status).toBe(200);

    const patchResponse = await patchCustomer(
      jsonRequest("PATCH", `http://localhost/api/customers/${id}`, { company: "Ledger Co", status: "inactive" }),
      params(id),
    );
    const patched = await readJson(patchResponse);
    expect(patchResponse.status).toBe(200);
    expect(patched?.data).toMatchObject({ company: "Ledger Co", status: "inactive" });

    const deleteResponse = await deleteCustomer(jsonRequest("DELETE", `http://localhost/api/customers/${id}`), params(id));
    expect(deleteResponse.status).toBe(204);
    expect(await getCustomersCollection().countDocuments({ _id: new ObjectId(id) })).toBe(0);
  });

  it("validates required fields, invalid status, invalid ids, and duplicate emails", async () => {
    mockSession(userA);

    const missing = await createCustomer(jsonRequest("POST", "http://localhost/api/customers", { firstName: "Only" }));
    expect(missing.status).toBe(400);
    expect(await readJson(missing)).toEqual({ error: "lastName is required" });

    const invalidStatus = await createCustomer(
      jsonRequest("POST", "http://localhost/api/customers", { firstName: "A", lastName: "B", status: "archived" }),
    );
    expect(invalidStatus.status).toBe(400);

    await seedCustomer(userA.id, { email: "dup@example.test" });
    const duplicate = await createCustomer(
      jsonRequest("POST", "http://localhost/api/customers", { firstName: "Dup", lastName: "User", email: "dup@example.test" }),
    );
    expect(duplicate.status).toBe(409);

    const invalidId = await getCustomer(jsonRequest("GET", "http://localhost/api/customers/not-an-id"), params("not-an-id"));
    expect(invalidId.status).toBe(400);
    expect(await readJson(invalidId)).toEqual({ error: "Invalid customer id" });
  });

  it("rejects unauthorized requests", async () => {
    mockSession(null);
    const response = await createCustomer(jsonRequest("POST", "http://localhost/api/customers", { firstName: "X", lastName: "Y" }));
    expect(response.status).toBe(401);
  });
});
