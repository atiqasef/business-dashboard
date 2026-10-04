import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  GET as listOrders,
  POST as createOrder,
  GET_BY_ID as getOrder,
  PATCH as patchOrder,
  DELETE as deleteOrder,
} from "@/server/api/orders";
import { getOrdersCollection } from "@/server/db/models/order";
import { mockSession, userA, userB } from "../helpers/auth";
import { seedCustomer, seedOrder, seedProduct } from "../helpers/fixtures";
import { jsonRequest, params, readJson } from "../helpers/http";

describe("order API and business logic", () => {
  it("lists orders and filters by status for the authenticated owner", async () => {
    mockSession(userA);
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id, { price: 20 });
    await seedOrder(userA.id, customer._id, product._id, { status: "pending" });
    await seedOrder(userA.id, customer._id, product._id, { status: "completed" });
    await seedOrder(userB.id, (await seedCustomer(userB.id))._id, (await seedProduct(userB.id))._id, { status: "pending" });

    const all = await readJson(await listOrders(jsonRequest("GET", "http://localhost/api/orders")));
    expect((all?.data as unknown[]).length).toBe(2);

    const completed = await readJson(await listOrders(jsonRequest("GET", "http://localhost/api/orders?status=completed")));
    expect((completed?.data as Array<{ status: string }>).every((order) => order.status === "completed")).toBe(true);
    expect((completed?.data as unknown[]).length).toBe(1);
  });

  it("creates orders with server-side totals and ignores client financial fields", async () => {
    mockSession(userA);
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id, { price: 18.5 });

    const response = await createOrder(
      jsonRequest("POST", "http://localhost/api/orders", {
        customerId: customer.id,
        items: [{ productId: product.id, quantity: 3, unitPrice: 1, lineTotal: 1 }],
        discount: 5.5,
        status: "confirmed",
        ownerId: userB.id,
        subtotal: 1,
        total: 1,
      }),
    );
    const body = await readJson(response);
    const data = body?.data as {
      id: string;
      subtotal: number;
      discount: number;
      total: number;
      items: Array<{ unitPrice: number; lineTotal: number; quantity: number }>;
      status: string;
    };

    expect(response.status).toBe(201);
    expect(data.status).toBe("confirmed");
    expect(data.items[0]).toMatchObject({ unitPrice: 18.5, quantity: 3, lineTotal: 55.5 });
    expect(data.subtotal).toBe(55.5);
    expect(data.discount).toBe(5.5);
    expect(data.total).toBe(50);

    const stored = await getOrdersCollection().findOne({ _id: new ObjectId(data.id) });
    expect(stored?.ownerId).toBe(userA.id);
    expect(stored?.total).toBe(50);
  });

  it("supports status updates and recalculates totals when items or discount change", async () => {
    mockSession(userA);
    const customer = await seedCustomer(userA.id);
    const productA = await seedProduct(userA.id, { price: 10, sku: "A-1" });
    const productB = await seedProduct(userA.id, { price: 25, sku: "B-1" });
    const order = await seedOrder(userA.id, customer._id, productA._id, { status: "pending", subtotal: 20, total: 20 });

    const statusResponse = await patchOrder(
      jsonRequest("PATCH", `http://localhost/api/orders/${order.id}`, { status: "completed" }),
      params(order.id),
    );
    expect(statusResponse.status).toBe(200);
    expect((await readJson(statusResponse))?.data).toMatchObject({ status: "completed" });

    const itemsResponse = await patchOrder(
      jsonRequest("PATCH", `http://localhost/api/orders/${order.id}`, {
        items: [{ productId: productB.id, quantity: 2 }],
        discount: 5,
      }),
      params(order.id),
    );
    const itemsBody = await readJson(itemsResponse);
    expect(itemsResponse.status).toBe(200);
    expect(itemsBody?.data).toMatchObject({ subtotal: 50, discount: 5, total: 45, status: "completed" });

    const discountResponse = await patchOrder(
      jsonRequest("PATCH", `http://localhost/api/orders/${order.id}`, { discount: 10 }),
      params(order.id),
    );
    expect(discountResponse.status).toBe(200);
    expect((await readJson(discountResponse))?.data).toMatchObject({ discount: 10, total: 40 });
  });

  it("rejects invalid order payloads and protected field updates", async () => {
    mockSession(userA);
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id, { price: 12 });
    const foreignProduct = await seedProduct(userB.id, { price: 99 });
    const order = await seedOrder(userA.id, customer._id, product._id);

    const missingItems = await createOrder(
      jsonRequest("POST", "http://localhost/api/orders", { customerId: customer.id, items: [] }),
    );
    expect(missingItems.status).toBe(400);

    const duplicateItems = await createOrder(
      jsonRequest("POST", "http://localhost/api/orders", {
        customerId: customer.id,
        items: [
          { productId: product.id, quantity: 1 },
          { productId: product.id, quantity: 2 },
        ],
      }),
    );
    expect(duplicateItems.status).toBe(400);
    expect(await readJson(duplicateItems)).toEqual({ error: "Duplicate product IDs are not allowed" });

    const foreign = await createOrder(
      jsonRequest("POST", "http://localhost/api/orders", {
        customerId: customer.id,
        items: [{ productId: foreignProduct.id, quantity: 1 }],
      }),
    );
    expect(foreign.status).toBe(404);

    const overDiscount = await createOrder(
      jsonRequest("POST", "http://localhost/api/orders", {
        customerId: customer.id,
        items: [{ productId: product.id, quantity: 1 }],
        discount: 100,
      }),
    );
    expect(overDiscount.status).toBe(400);

    const invalidStatus = await createOrder(
      jsonRequest("POST", "http://localhost/api/orders", {
        customerId: customer.id,
        items: [{ productId: product.id, quantity: 1 }],
        status: "shipped",
      }),
    );
    expect(invalidStatus.status).toBe(400);

    const protectedField = await patchOrder(
      jsonRequest("PATCH", `http://localhost/api/orders/${order.id}`, { total: 1 }),
      params(order.id),
    );
    expect(protectedField.status).toBe(400);
    expect(await readJson(protectedField)).toEqual({ error: "total cannot be updated" });

    const invalidId = await getOrder(jsonRequest("GET", "http://localhost/api/orders/bad"), params("bad"));
    expect(invalidId.status).toBe(400);
  });

  it("deletes owned orders and rejects unauthorized access", async () => {
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id);
    const order = await seedOrder(userA.id, customer._id, product._id);

    mockSession(null);
    expect((await deleteOrder(jsonRequest("DELETE", `http://localhost/api/orders/${order.id}`), params(order.id))).status).toBe(401);

    mockSession(userA);
    const deleteResponse = await deleteOrder(jsonRequest("DELETE", `http://localhost/api/orders/${order.id}`), params(order.id));
    expect(deleteResponse.status).toBe(204);
    expect(await getOrdersCollection().countDocuments({ _id: order._id })).toBe(0);
  });
});
