import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { GET as listProducts, POST as createProduct, GET_BY_ID as getProduct, PATCH as patchProduct, DELETE as deleteProduct } from "@/server/api/products";
import { getProductsCollection } from "@/server/db/models/product";
import { mockSession, userA, userB } from "../helpers/auth";
import { seedProduct } from "../helpers/fixtures";
import { jsonRequest, params, readJson } from "../helpers/http";

describe("product API", () => {
  it("lists, searches, filters, and paginates products", async () => {
    mockSession(userA);
    await seedProduct(userA.id, { name: "Field Notes", sku: "NOTE-1", category: "Stationery", status: "active" });
    await seedProduct(userA.id, { name: "Harbor Lamp", sku: "LAMP-1", category: "Workspace", status: "inactive" });
    await seedProduct(userA.id, { name: "Market Tote", sku: "TOTE-1", category: "Accessories", status: "active" });

    const page = await readJson(await listProducts(jsonRequest("GET", "http://localhost/api/products?page=1&pageSize=2")));
    expect((page?.data as unknown[]).length).toBe(2);
    expect(page?.pagination).toMatchObject({ total: 3, totalPages: 2 });

    const search = await readJson(await listProducts(jsonRequest("GET", "http://localhost/api/products?search=Lamp")));
    expect((search?.data as Array<{ name: string }>).map((item) => item.name)).toEqual(["Harbor Lamp"]);

    const filtered = await readJson(await listProducts(jsonRequest("GET", "http://localhost/api/products?status=inactive")));
    expect((filtered?.data as Array<{ sku: string }>).map((item) => item.sku)).toEqual(["LAMP-1"]);
  });

  it("creates, updates, and deletes products with server-owned fields", async () => {
    mockSession(userA);

    const createResponse = await createProduct(
      jsonRequest("POST", "http://localhost/api/products", {
        name: "Planner",
        sku: "PLAN-1",
        price: 26,
        costPrice: 10,
        stock: 5,
        category: "Stationery",
        ownerId: userB.id,
      }),
    );
    const created = await readJson(createResponse);
    const id = (created?.data as { id: string }).id;
    expect(createResponse.status).toBe(201);

    const stored = await getProductsCollection().findOne({ _id: new ObjectId(id) });
    expect(stored?.ownerId).toBe(userA.id);

    const patchResponse = await patchProduct(
      jsonRequest("PATCH", `http://localhost/api/products/${id}`, { stock: 8, status: "inactive", ownerId: userB.id }),
      params(id),
    );
    const patched = await readJson(patchResponse);
    expect(patchResponse.status).toBe(200);
    expect(patched?.data).toMatchObject({ stock: 8, status: "inactive" });

    const afterPatch = await getProductsCollection().findOne({ _id: new ObjectId(id) });
    expect(afterPatch?.ownerId).toBe(userA.id);

    const getResponse = await getProduct(jsonRequest("GET", `http://localhost/api/products/${id}`), params(id));
    expect(getResponse.status).toBe(200);

    const deleteResponse = await deleteProduct(jsonRequest("DELETE", `http://localhost/api/products/${id}`), params(id));
    expect(deleteResponse.status).toBe(204);
  });

  it("validates required fields, numeric values, duplicates, and invalid ids", async () => {
    mockSession(userA);

    const missing = await createProduct(jsonRequest("POST", "http://localhost/api/products", { name: "No SKU", price: 10, stock: 1 }));
    expect(missing.status).toBe(400);

    const invalidPrice = await createProduct(
      jsonRequest("POST", "http://localhost/api/products", { name: "Bad", sku: "BAD-1", price: 0, stock: 1 }),
    );
    expect(invalidPrice.status).toBe(400);

    await seedProduct(userA.id, { sku: "DUP-1" });
    const duplicate = await createProduct(
      jsonRequest("POST", "http://localhost/api/products", { name: "Dup", sku: "DUP-1", price: 12, stock: 1 }),
    );
    expect(duplicate.status).toBe(409);

    const invalidId = await getProduct(jsonRequest("GET", "http://localhost/api/products/bad-id"), params("bad-id"));
    expect(invalidId.status).toBe(400);
    expect(await readJson(invalidId)).toEqual({ error: "Invalid product id" });
  });

  it("rejects unauthorized product mutations", async () => {
    mockSession(null);
    const response = await createProduct(
      jsonRequest("POST", "http://localhost/api/products", { name: "X", sku: "X-1", price: 5, stock: 1 }),
    );
    expect(response.status).toBe(401);
  });
});
