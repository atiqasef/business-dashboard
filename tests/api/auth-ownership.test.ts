import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { GET as listCustomers, POST as createCustomer } from "@/server/api/customers";
import { GET as getCustomer, PATCH as patchCustomer, DELETE as deleteCustomer } from "@/app/api/customers/[id]/route";
import { GET as listProducts, POST as createProduct } from "@/server/api/products";
import { GET_BY_ID as getProduct, PATCH as patchProduct, DELETE as deleteProduct } from "@/server/api/products";
import { GET as listOrders, POST as createOrder } from "@/server/api/orders";
import { GET_BY_ID as getOrder, PATCH as patchOrder, DELETE as deleteOrder } from "@/server/api/orders";
import { getCustomersCollection } from "@/server/db/models/customer";
import { getProductsCollection } from "@/server/db/models/product";
import { getOrdersCollection } from "@/server/db/models/order";
import { mockSession, userA, userB } from "../helpers/auth";
import { jsonRequest, params, readJson } from "../helpers/http";
import { seedCustomer, seedOrder, seedProduct } from "../helpers/fixtures";

describe("authentication", () => {
  it("rejects unauthenticated customer, product, and order list requests", async () => {
    mockSession(null);

    const customers = await listCustomers(jsonRequest("GET", "http://localhost/api/customers"));
    const products = await listProducts(jsonRequest("GET", "http://localhost/api/products"));
    const orders = await listOrders(jsonRequest("GET", "http://localhost/api/orders"));

    expect(customers.status).toBe(401);
    expect(products.status).toBe(401);
    expect(orders.status).toBe(401);
    expect(await readJson(customers)).toEqual({ error: "Authentication required" });
  });

  it("allows authenticated access to owned data", async () => {
    mockSession(userA);
    await seedCustomer(userA.id, { firstName: "Owned" });

    const response = await listCustomers(jsonRequest("GET", "http://localhost/api/customers"));
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(Array.isArray(body?.data)).toBe(true);
    expect((body?.data as unknown[]).length).toBe(1);
  });

  it("ignores client-supplied ownerId on create", async () => {
    mockSession(userA);

    const response = await createCustomer(
      jsonRequest("POST", "http://localhost/api/customers", {
        firstName: "Pat",
        lastName: "Lee",
        email: "pat.lee@example.test",
        ownerId: userB.id,
        userId: userB.id,
      }),
    );
    const body = await readJson(response);

    expect(response.status).toBe(201);
    const stored = await getCustomersCollection().findOne({ email: "pat.lee@example.test" });
    expect(stored?.ownerId).toBe(userA.id);
    expect((body?.data as { id?: string })?.id).toBe(stored?._id?.toHexString());
  });
});

describe("ownership isolation", () => {
  it("prevents User A from reading User B customers/products/orders", async () => {
    const customerB = await seedCustomer(userB.id, { firstName: "Private" });
    const productB = await seedProduct(userB.id, { name: "Secret Widget" });
    const orderB = await seedOrder(userB.id, customerB._id, productB._id);

    mockSession(userA);

    const customerResponse = await getCustomer(jsonRequest("GET", `http://localhost/api/customers/${customerB.id}`), params(customerB.id));
    const productResponse = await getProduct(jsonRequest("GET", `http://localhost/api/products/${productB.id}`), params(productB.id));
    const orderResponse = await getOrder(jsonRequest("GET", `http://localhost/api/orders/${orderB.id}`), params(orderB.id));

    expect(customerResponse.status).toBe(404);
    expect(productResponse.status).toBe(404);
    expect(orderResponse.status).toBe(404);
  });

  it("allows User A to read only User A records in list endpoints", async () => {
    await seedCustomer(userA.id, { firstName: "Alice" });
    await seedCustomer(userB.id, { firstName: "Bob" });
    await seedProduct(userA.id, { name: "A Product" });
    await seedProduct(userB.id, { name: "B Product" });

    mockSession(userA);

    const customers = await readJson(await listCustomers(jsonRequest("GET", "http://localhost/api/customers")));
    const products = await readJson(await listProducts(jsonRequest("GET", "http://localhost/api/products")));

    expect((customers?.data as Array<{ firstName: string }>).map((item) => item.firstName)).toEqual(["Alice"]);
    expect((products?.data as Array<{ name: string }>).map((item) => item.name)).toEqual(["A Product"]);
  });

  it("prevents update/delete of another user's records", async () => {
    const customerB = await seedCustomer(userB.id);
    const productB = await seedProduct(userB.id);
    const orderB = await seedOrder(userB.id, customerB._id, productB._id);

    mockSession(userA);

    const customerPatch = await patchCustomer(
      jsonRequest("PATCH", `http://localhost/api/customers/${customerB.id}`, { firstName: "Hijacked" }),
      params(customerB.id),
    );
    const productPatch = await patchProduct(
      jsonRequest("PATCH", `http://localhost/api/products/${productB.id}`, { name: "Hijacked" }),
      params(productB.id),
    );
    const orderPatch = await patchOrder(
      jsonRequest("PATCH", `http://localhost/api/orders/${orderB.id}`, { status: "cancelled" }),
      params(orderB.id),
    );
    const customerDelete = await deleteCustomer(jsonRequest("DELETE", `http://localhost/api/customers/${customerB.id}`), params(customerB.id));
    const productDelete = await deleteProduct(jsonRequest("DELETE", `http://localhost/api/products/${productB.id}`), params(productB.id));
    const orderDelete = await deleteOrder(jsonRequest("DELETE", `http://localhost/api/orders/${orderB.id}`), params(orderB.id));

    expect(customerPatch.status).toBe(404);
    expect(productPatch.status).toBe(404);
    expect(orderPatch.status).toBe(404);
    expect(customerDelete.status).toBe(404);
    expect(productDelete.status).toBe(404);
    expect(orderDelete.status).toBe(404);

    expect(await getCustomersCollection().countDocuments({ _id: customerB._id })).toBe(1);
    expect(await getProductsCollection().countDocuments({ _id: productB._id })).toBe(1);
    expect(await getOrdersCollection().countDocuments({ _id: orderB._id })).toBe(1);
  });

  it("associates creates with the authenticated user for products and orders", async () => {
    mockSession(userA);
    const customer = await seedCustomer(userA.id);
    const product = await seedProduct(userA.id, { price: 15 });

    const productResponse = await createProduct(
      jsonRequest("POST", "http://localhost/api/products", {
        name: "Desk Lamp",
        sku: "LAMP-A-1",
        price: 40,
        stock: 3,
        ownerId: userB.id,
      }),
    );
    const productBody = await readJson(productResponse);
    expect(productResponse.status).toBe(201);

    const storedProduct = await getProductsCollection().findOne({ sku: "LAMP-A-1" });
    expect(storedProduct?.ownerId).toBe(userA.id);

    const orderResponse = await createOrder(
      jsonRequest("POST", "http://localhost/api/orders", {
        customerId: customer.id,
        items: [{ productId: product.id, quantity: 1 }],
        discount: 0,
        status: "pending",
        ownerId: userB.id,
        total: 999,
        subtotal: 999,
      }),
    );
    const orderBody = await readJson(orderResponse);
    expect(orderResponse.status).toBe(201);

    const createdOrderId = (orderBody?.data as { id: string }).id;
    const createdOrder = await getOrdersCollection().findOne({ _id: new ObjectId(createdOrderId) });
    expect(createdOrder?.ownerId).toBe(userA.id);
    expect(createdOrder?.total).toBe(15);
    expect(createdOrder?.subtotal).toBe(15);
    expect((productBody?.data as { id: string }).id).toBeTruthy();
  });
});
