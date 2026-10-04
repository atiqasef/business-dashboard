import { describe, expect, it } from "vitest";
import { GET as listCustomers, POST as createCustomer } from "@/server/api/customers";
import { PATCH as patchCustomer, DELETE as deleteCustomer } from "@/app/api/customers/[id]/route";
import { GET as listProducts, POST as createProduct } from "@/server/api/products";
import { PATCH as patchProduct, DELETE as deleteProduct } from "@/server/api/products";
import { GET as listOrders, POST as createOrder } from "@/server/api/orders";
import { PATCH as patchOrder, DELETE as deleteOrder } from "@/server/api/orders";
import { getCustomersCollection } from "@/server/db/models/customer";
import { getProductsCollection } from "@/server/db/models/product";
import { getOrdersCollection } from "@/server/db/models/order";
import { demoUser, mockSession, userA } from "../helpers/auth";
import { markDemoUser, seedCustomer, seedOrder, seedProduct } from "../helpers/fixtures";
import { jsonRequest, params, readJson } from "../helpers/http";

describe("demo account read-only protection", () => {
  it("allows demo users to read their own data", async () => {
    await markDemoUser();
    await seedCustomer(demoUser.id, { firstName: "Demo" });
    await seedProduct(demoUser.id, { name: "Demo Product" });

    mockSession(demoUser);

    const customers = await listCustomers(jsonRequest("GET", "http://localhost/api/customers"));
    const products = await listProducts(jsonRequest("GET", "http://localhost/api/products"));
    const orders = await listOrders(jsonRequest("GET", "http://localhost/api/orders"));

    expect(customers.status).toBe(200);
    expect(products.status).toBe(200);
    expect(orders.status).toBe(200);
    expect(((await readJson(customers))?.data as unknown[]).length).toBe(1);
  });

  it("blocks demo mutations for customers, products, and orders", async () => {
    await markDemoUser();
    const customer = await seedCustomer(demoUser.id);
    const product = await seedProduct(demoUser.id, { price: 12 });
    const order = await seedOrder(demoUser.id, customer._id, product._id);

    mockSession(demoUser);

    const createCustomerResponse = await createCustomer(
      jsonRequest("POST", "http://localhost/api/customers", { firstName: "Nope", lastName: "Demo" }),
    );
    const createProductResponse = await createProduct(
      jsonRequest("POST", "http://localhost/api/products", { name: "Nope", sku: "NOPE-1", price: 10, stock: 1 }),
    );
    const createOrderResponse = await createOrder(
      jsonRequest("POST", "http://localhost/api/orders", {
        customerId: customer.id,
        items: [{ productId: product.id, quantity: 1 }],
      }),
    );

    const patchCustomerResponse = await patchCustomer(
      jsonRequest("PATCH", `http://localhost/api/customers/${customer.id}`, { firstName: "Blocked" }),
      params(customer.id),
    );
    const patchProductResponse = await patchProduct(
      jsonRequest("PATCH", `http://localhost/api/products/${product.id}`, { name: "Blocked" }),
      params(product.id),
    );
    const patchOrderResponse = await patchOrder(
      jsonRequest("PATCH", `http://localhost/api/orders/${order.id}`, { status: "cancelled" }),
      params(order.id),
    );

    const deleteCustomerResponse = await deleteCustomer(jsonRequest("DELETE", `http://localhost/api/customers/${customer.id}`), params(customer.id));
    const deleteProductResponse = await deleteProduct(jsonRequest("DELETE", `http://localhost/api/products/${product.id}`), params(product.id));
    const deleteOrderResponse = await deleteOrder(jsonRequest("DELETE", `http://localhost/api/orders/${order.id}`), params(order.id));

    for (const response of [
      createCustomerResponse,
      createProductResponse,
      createOrderResponse,
      patchCustomerResponse,
      patchProductResponse,
      patchOrderResponse,
      deleteCustomerResponse,
      deleteProductResponse,
      deleteOrderResponse,
    ]) {
      expect(response.status).toBe(403);
      expect(await readJson(response)).toEqual({ error: "Demo account is read-only" });
    }

    expect(await getCustomersCollection().countDocuments({ _id: customer._id, firstName: "Ada" })).toBe(1);
    expect(await getProductsCollection().countDocuments({ _id: product._id })).toBe(1);
    expect(await getOrdersCollection().countDocuments({ _id: order._id, status: "pending" })).toBe(1);
  });

  it("keeps normal authenticated users able to mutate their own records", async () => {
    mockSession(userA);

    const createResponse = await createCustomer(
      jsonRequest("POST", "http://localhost/api/customers", {
        firstName: "Normal",
        lastName: "User",
        email: "normal.user@example.test",
      }),
    );
    const created = await readJson(createResponse);
    const id = (created?.data as { id: string }).id;

    expect(createResponse.status).toBe(201);

    const patchResponse = await patchCustomer(
      jsonRequest("PATCH", `http://localhost/api/customers/${id}`, { firstName: "Updated" }),
      params(id),
    );
    expect(patchResponse.status).toBe(200);

    const deleteResponse = await deleteCustomer(jsonRequest("DELETE", `http://localhost/api/customers/${id}`), params(id));
    expect(deleteResponse.status).toBe(204);
    expect(await getCustomersCollection().countDocuments({ email: "normal.user@example.test" })).toBe(0);
  });
});
