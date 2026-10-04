import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { POST as sendReminder } from "@/server/api/invoice-reminder";
import { GET as listReminders, GET_BY_ID as getReminder, RETRY as retryReminder } from "@/server/api/notifications-reminders";
import { GET as cronReminders } from "@/server/api/cron-invoice-reminders";
import { getInvoiceRemindersCollection } from "@/server/db/models/invoice-reminder";
import { sendEmail } from "@/server/email/send-email";
import { EmailDeliveryError } from "@/server/email/types";
import { processInvoiceReminderCron } from "@/server/reminders/process-cron";
import { createInvoiceFromOrder, createPaymentForInvoice } from "../helpers/billing";
import { demoUser, mockSession, userA, userB } from "../helpers/auth";
import { markDemoUser, seedCustomer, seedOrder, seedProduct } from "../helpers/fixtures";
import { jsonRequest, params, readJson } from "../helpers/http";

vi.mock("@/server/email/send-email", () => ({
  sendEmail: vi.fn(),
}));

function daysFromNow(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(12, 0, 0, 0);
  return date;
}

describe("invoice reminder authentication", () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockReset();
    vi.mocked(sendEmail).mockResolvedValue({ id: "reminder_email_1" });
    delete process.env.CRON_SECRET;
  });

  it("rejects unauthenticated list, send, retry, and unauthorized cron", async () => {
    mockSession(null);
    expect((await listReminders(jsonRequest("GET", "http://localhost/api/notifications/reminders"))).status).toBe(401);
    expect(
      (await sendReminder(jsonRequest("POST", "http://localhost/api/invoices/000000000000000000000001/reminder"), params("000000000000000000000001")))
        .status,
    ).toBe(401);
    expect(
      (
        await retryReminder(
          jsonRequest("POST", "http://localhost/api/notifications/reminders/000000000000000000000001/retry"),
          params("000000000000000000000001"),
        )
      ).status,
    ).toBe(401);

    process.env.CRON_SECRET = "test-cron-secret";
    expect((await cronReminders(jsonRequest("GET", "http://localhost/api/cron/invoice-reminders"))).status).toBe(401);
    expect(
      (
        await cronReminders(
          new Request("http://localhost/api/cron/invoice-reminders", {
            method: "GET",
            headers: { authorization: "Bearer wrong" },
          }),
        )
      ).status,
    ).toBe(401);
  });
});

describe("invoice reminder ownership and eligibility", () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockReset();
    vi.mocked(sendEmail).mockResolvedValue({ id: "reminder_email_2" });
  });

  it("lets an owner send a reminder and hides foreign reminder history", async () => {
    const customer = await seedCustomer(userA.id, {
      firstName: "Ada",
      email: "ada.remind@example.test",
    });
    const product = await seedProduct(userA.id, { price: 40 });
    const order = await seedOrder(userA.id, customer._id, product._id, { total: 40, subtotal: 40 });
    const invoice = await createInvoiceFromOrder(userA, order.id, {
      dueDate: daysFromNow(-2).toISOString(),
    });
    const invoiceId = String(invoice.data?.id);

    mockSession(userA);
    const sent = await sendReminder(jsonRequest("POST", `http://localhost/api/invoices/${invoiceId}/reminder`), params(invoiceId));
    const sentBody = await readJson(sent);
    expect(sent.status).toBe(200);
    expect(sentBody?.data).toMatchObject({
      sent: true,
      to: "ada.remind@example.test",
      invoiceNumber: invoice.data?.invoiceNumber,
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const emailPayload = vi.mocked(sendEmail).mock.calls[0]?.[0];
    expect(emailPayload?.to).toBe("ada.remind@example.test");
    expect(emailPayload?.subject).toMatch(/Payment reminder/i);
    expect(emailPayload?.attachments?.[0]?.contentType).toBe("application/pdf");

    const listed = await listReminders(jsonRequest("GET", "http://localhost/api/notifications/reminders"));
    const listedBody = await readJson(listed);
    expect(listed.status).toBe(200);
    expect((listedBody?.data as unknown[]).length).toBe(1);
    expect(listedBody?.overview).toMatchObject({ remindersSent: 1 });

    const reminderId = String((listedBody?.data as Array<{ id: string }>)[0]?.id);
    mockSession(userB);
    const foreignList = await listReminders(jsonRequest("GET", "http://localhost/api/notifications/reminders"));
    expect(((await readJson(foreignList))?.data as unknown[]).length).toBe(0);
    const foreignDetail = await getReminder(
      jsonRequest("GET", `http://localhost/api/notifications/reminders/${reminderId}`),
      params(reminderId),
    );
    expect(foreignDetail.status).toBe(404);

    mockSession(userB);
    const foreignSend = await sendReminder(
      jsonRequest("POST", `http://localhost/api/invoices/${invoiceId}/reminder`, { ownerId: userA.id }),
      params(invoiceId),
    );
    expect(foreignSend.status).toBe(404);
  });

  it("rejects cancelled, paid, and missing-email invoices", async () => {
    const customerNoEmail = await seedCustomer(userA.id, { email: undefined });
    const product = await seedProduct(userA.id, { price: 20 });
    const order = await seedOrder(userA.id, customerNoEmail._id, product._id, { total: 20, subtotal: 20 });
    const invoice = await createInvoiceFromOrder(userA, order.id);
    const invoiceId = String(invoice.data?.id);

    mockSession(userA);
    const noEmail = await sendReminder(jsonRequest("POST", `http://localhost/api/invoices/${invoiceId}/reminder`), params(invoiceId));
    expect(noEmail.status).toBe(422);

    const customer = await seedCustomer(userA.id, { email: "pay@example.test" });
    const order2 = await seedOrder(userA.id, customer._id, product._id, { total: 20, subtotal: 20 });
    const paidInvoice = await createInvoiceFromOrder(userA, order2.id);
    await createPaymentForInvoice(userA, String(paidInvoice.data?.id), 20);
    const paidSend = await sendReminder(
      jsonRequest("POST", `http://localhost/api/invoices/${paidInvoice.data?.id}/reminder`),
      params(String(paidInvoice.data?.id)),
    );
    expect(paidSend.status).toBe(409);

    const order3 = await seedOrder(userA.id, customer._id, product._id, { total: 20, subtotal: 20 });
    const cancelled = await createInvoiceFromOrder(userA, order3.id);
    const { DELETE: cancelInvoice } = await import("@/server/api/invoices");
    await cancelInvoice(
      jsonRequest("DELETE", `http://localhost/api/invoices/${cancelled.data?.id}`),
      params(String(cancelled.data?.id)),
    );
    const cancelledSend = await sendReminder(
      jsonRequest("POST", `http://localhost/api/invoices/${cancelled.data?.id}/reminder`),
      params(String(cancelled.data?.id)),
    );
    expect(cancelledSend.status).toBe(409);
  });
});

describe("invoice reminder duplicate protection retry and failures", () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockReset();
    vi.mocked(sendEmail).mockResolvedValue({ id: "reminder_email_3" });
  });

  it("blocks immediate duplicate manual sends and allows retry of failed reminders", async () => {
    const customer = await seedCustomer(userA.id, { email: "retry@example.test" });
    const product = await seedProduct(userA.id, { price: 30 });
    const order = await seedOrder(userA.id, customer._id, product._id, { total: 30, subtotal: 30 });
    const invoice = await createInvoiceFromOrder(userA, order.id);
    const invoiceId = String(invoice.data?.id);

    mockSession(userA);
    const first = await sendReminder(jsonRequest("POST", `http://localhost/api/invoices/${invoiceId}/reminder`), params(invoiceId));
    expect(first.status).toBe(200);

    const duplicate = await sendReminder(jsonRequest("POST", `http://localhost/api/invoices/${invoiceId}/reminder`), params(invoiceId));
    expect(duplicate.status).toBe(409);

    vi.mocked(sendEmail).mockRejectedValueOnce(new EmailDeliveryError("provider down"));
    // Seed a failed reminder by temporarily clearing cooldown via older createdAt.
    await getInvoiceRemindersCollection().updateMany(
      { ownerId: userA.id, invoiceId: new ObjectId(invoiceId), type: "manual", status: "sent" },
      { $set: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } },
    );

    const failedSend = await sendReminder(jsonRequest("POST", `http://localhost/api/invoices/${invoiceId}/reminder`), params(invoiceId));
    expect(failedSend.status).toBe(502);
    const failedBody = await readJson(failedSend);
    const failedId = String((failedBody?.data as { reminder: { id: string } }).reminder.id);
    const failedBefore = await getInvoiceRemindersCollection().findOne({ _id: new ObjectId(failedId) });
    expect(failedBefore?.status).toBe("failed");

    vi.mocked(sendEmail).mockResolvedValue({ id: "reminder_retry_ok" });
    // Age the successful send so retry is not blocked by cooldown.
    await getInvoiceRemindersCollection().updateMany(
      { ownerId: userA.id, invoiceId: new ObjectId(invoiceId), type: "manual", status: "sent" },
      { $set: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } },
    );

    const retried = await retryReminder(
      jsonRequest("POST", `http://localhost/api/notifications/reminders/${failedId}/retry`),
      params(failedId),
    );
    expect(retried.status).toBe(200);
    const retryBody = await readJson(retried);
    expect((retryBody?.data as { reminder: { id: string; status: string } }).reminder.status).toBe("sent");
    expect((retryBody?.data as { reminder: { id: string } }).reminder.id).not.toBe(failedId);

    const original = await getInvoiceRemindersCollection().findOne({ _id: new ObjectId(failedId) });
    expect(original?.status).toBe("failed");
  });
});

describe("invoice reminder cron and demo", () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockReset();
    vi.mocked(sendEmail).mockResolvedValue({ id: "cron_email_1" });
    process.env.CRON_SECRET = "cron-test-secret";
  });

  it("processes eligible invoices with a valid cron secret and skips paid invoices", async () => {
    const customer = await seedCustomer(userA.id, { email: "cron@example.test" });
    const product = await seedProduct(userA.id, { price: 25 });
    const overdueOrder = await seedOrder(userA.id, customer._id, product._id, { total: 25, subtotal: 25 });
    const overdueInvoice = await createInvoiceFromOrder(userA, overdueOrder.id, {
      dueDate: daysFromNow(-3).toISOString(),
    });

    const paidOrder = await seedOrder(userA.id, customer._id, product._id, { total: 25, subtotal: 25 });
    const paidInvoice = await createInvoiceFromOrder(userA, paidOrder.id, {
      dueDate: daysFromNow(-1).toISOString(),
    });
    await createPaymentForInvoice(userA, String(paidInvoice.data?.id), 25);

    const response = await cronReminders(
      new Request("http://localhost/api/cron/invoice-reminders", {
        method: "GET",
        headers: { authorization: "Bearer cron-test-secret" },
      }),
    );
    expect(response.status).toBe(200);
    const summary = await readJson(response);
    expect(summary).toMatchObject({
      processed: expect.any(Number),
      sent: expect.any(Number),
      failed: expect.any(Number),
      skipped: expect.any(Number),
    });
    expect((summary?.sent as number) + (summary?.failed as number) + (summary?.skipped as number)).toBeGreaterThanOrEqual(
      summary?.processed as number,
    );

    const reminders = await getInvoiceRemindersCollection()
      .find({ ownerId: userA.id, invoiceId: new ObjectId(String(overdueInvoice.data?.id)) })
      .toArray();
    expect(reminders.some((item) => item.type === "overdue" && item.status === "sent")).toBe(true);

    const paidReminders = await getInvoiceRemindersCollection().countDocuments({
      ownerId: userA.id,
      invoiceId: new ObjectId(String(paidInvoice.data?.id)),
    });
    expect(paidReminders).toBe(0);

    // Duplicate cron run should skip due to cooldown.
    const second = await processInvoiceReminderCron();
    expect(second.sent).toBe(0);
  });

  it("allows demo read and rejects demo send/retry", async () => {
    await markDemoUser();
    const customer = await seedCustomer(demoUser.id, { email: "demo.remind@example.test" });
    const product = await seedProduct(demoUser.id, { price: 15 });
    const order = await seedOrder(demoUser.id, customer._id, product._id, { total: 15, subtotal: 15 });
    const { getInvoicesCollection } = await import("@/server/db/models/invoice");
    const now = new Date();
    const invoiceId = new ObjectId();
    await getInvoicesCollection().insertOne({
      _id: invoiceId,
      ownerId: demoUser.id,
      invoiceNumber: "INV-2026-000888",
      orderId: order._id,
      customerId: customer._id,
      customerSnapshot: { name: "Demo Customer", email: "demo.remind@example.test" },
      items: [{ productId: product._id, productName: product.name, quantity: 1, unitPrice: 15, lineTotal: 15 }],
      subtotal: 15,
      discount: 0,
      tax: 0,
      total: 15,
      paidAmount: 0,
      outstandingAmount: 15,
      issueDate: now,
      dueDate: daysFromNow(-1),
      status: "overdue",
      createdAt: now,
      updatedAt: now,
    });

    const reminderId = new ObjectId();
    await getInvoiceRemindersCollection().insertOne({
      _id: reminderId,
      ownerId: demoUser.id,
      invoiceId,
      customerId: customer._id,
      invoiceNumber: "INV-2026-000888",
      customerName: "Demo Customer",
      type: "manual",
      recipientEmail: "demo.remind@example.test",
      status: "failed",
      failedAt: now,
      errorMessage: "provider down",
      createdAt: now,
      updatedAt: now,
    });

    mockSession(demoUser);
    const listed = await listReminders(jsonRequest("GET", "http://localhost/api/notifications/reminders"));
    expect(listed.status).toBe(200);
    expect(((await readJson(listed))?.data as unknown[]).length).toBe(1);

    const send = await sendReminder(
      jsonRequest("POST", `http://localhost/api/invoices/${invoiceId.toHexString()}/reminder`),
      params(invoiceId.toHexString()),
    );
    expect(send.status).toBe(403);

    const retry = await retryReminder(
      jsonRequest("POST", `http://localhost/api/notifications/reminders/${reminderId.toHexString()}/retry`),
      params(reminderId.toHexString()),
    );
    expect(retry.status).toBe(403);
  });
});
