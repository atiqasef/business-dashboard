# Architecture

Ledger is a server-first Next.js App Router application. Pages render the workspace. Route handlers and server services own authorization, money, and database access. MongoDB is accessed with the native driver. There is no separate API process.

## Request flow

```text
Browser
  → Next.js page or route handler
    → session (Better Auth), or a public bearer token
      → server service
        → MongoDB collection scoped by owner
```

Authenticated pages live under the workspace layout: dashboard (`/`), customers, products, orders, invoices, payments, reports, notifications, settings, AI assistant (`/assistant`), and onboarding (`/onboarding`). `/dashboard` redirects to `/`.

`/login` and `/register` are public. `/invoice/<token>` and `/portal/<token>` are public and authorized by the token in the path, not by a session. Middleware does not authenticate `/api/*`. Each API handler checks the session or the token itself.

## Authentication

Better Auth provides email and password sessions. The session user id is the only owner id the server will use. Browser fields named `ownerId`, `userId`, `organizationId`, or `planId` are ignored.

Empty workspaces (no customers, products, orders, or invoices) are sent to `/onboarding` after signup or login. Workspaces that already have any of those records, and the demo account, land on `/`.

## Authorization and ownership

Business documents store `ownerId` equal to the Better Auth user id. Queries include that id. A record owned by someone else is treated as missing.

One organization is provisioned per user. `organizations.ownerUserId` maps 1:1 to the same user id. Business collections were not migrated to `organizationId`. There are no memberships, roles, or an organization switcher.

The demo user is marked read-only. Mutation handlers call `assertDemoWriteAllowed` and return 403. The reminder cron skips demo owners.

## Organization and entitlements

```text
User (Better Auth)
  → Organization (name, slug, ownerUserId, planId)
    → Subscription (optional Stripe subscription)
      → Effective plan
        → Feature flags and numeric limits
```

Plans are defined in code: `free`, `starter`, `pro`, `business`. They are entitlements, not a public pricing page.

Core billing features (reports, portals, PDFs, email, reminders, Stripe invoice payments, deterministic insights) are enabled on every plan, including Free. `aiAssistant` and `aiInsightSummary` are off on Free and on for Starter, Pro, and Business. Limits cover customers, products, orders, invoices, and a monthly AI query cap. Business plan resource limits are unlimited (`null`) except the AI cap.

Effective plan:

| Subscription state | Entitlement |
| --- | --- |
| No subscription | `organization.planId` (new orgs start on Free) |
| `active`, `trialing`, `past_due` | Subscription plan |
| `canceled` while `currentPeriodEnd` is still in the future | Subscription plan |
| `unpaid`, `incomplete`, `incomplete_expired`, `paused` | Free |

Settings displays plan and subscription status. Checkout and the billing portal are blocked for the demo account.

## MongoDB access

Collections are reached through server model helpers. Indexes cover owner scope, unique invoice numbers, Stripe event ids, and portal tokens. The app does not accept client-supplied Mongo operators.

`GET /api/health` pings the database and reports whether optional integrations are configured. The body contains status flags only.

## Invoice and payment flow

```text
Customer → Order → Invoice → Payment
```

- Order totals are calculated on the server from owned products.
- `POST /api/invoices` creates an invoice from an owned order. One active invoice per order. Cancelled invoices do not block a replacement.
- Invoice numbers look like `INV-YYYY-000001` and come from an atomic per-owner counter.
- Statuses: `draft`, `issued`, `partially_paid`, `paid`, `overdue`, `cancelled`.
- Manual payments cannot exceed the outstanding balance. Concurrent overpayment is guarded by an atomic reservation.
- Payments are voided rather than hard-deleted. Voiding recalculates invoice status. Stripe-recorded payments are not voided in the app.

Owner PDF: `GET /api/invoices/:id/pdf`.

Email: `POST /api/invoices/:id/email` sends that PDF through Resend to the customer email stored on the owner’s customer record.

## Stripe invoice payments

```text
Public invoice or portal
  → POST checkout route
    → Stripe Checkout Session (mode=payment, metadata invoice_checkout_v1)
      → Customer pays on Stripe
        → POST /api/webhooks/stripe
          → recordInvoicePayment
            → invoice outstanding balance and status
```

The Checkout amount is the current outstanding balance in USD. Card Checkout is the enabled method. Creating a new session expires the previous open session for that invoice. Demo-owned invoices cannot start Checkout. If Stripe is not configured, checkout returns 503.

The success redirect does not record a payment.

## Stripe subscription billing

```text
Settings
  → POST /api/billing/checkout
    → Stripe Checkout (mode=subscription, metadata saas_subscription_v1)
      → Webhook
        → local subscription document
          → organization plan
```

`POST /api/billing/portal` opens the Stripe Customer Portal. Redirect targets are built on the server from `NEXT_PUBLIC_APP_URL`.

The shared webhook verifies `stripe-signature` over the raw body, then branches:

- `checkout.session.completed` with subscription mode and `saas_subscription_v1` updates SaaS billing.
- `checkout.session.completed` with payment mode and `invoice_checkout_v1` records an invoice payment.
- `customer.subscription.created`, `updated`, and `deleted` sync the subscription.
- `invoice.paid` and `invoice.payment_failed` apply only when the Stripe invoice belongs to a subscription.

Invoice payment rows are never used as SaaS subscriptions. Unknown Price IDs do not unlock a paid plan.

Webhook events are stored by Stripe event id. A processed event is a duplicate. An event left in `processing` can be reclaimed after two minutes. The same Stripe PaymentIntent cannot create two local payments.

## Public portal tokens

| Link | URL | Scope |
| --- | --- | --- |
| Invoice | `/invoice/<token>` | One invoice |
| Invoice PDF | `/invoice/<token>/pdf` | That invoice |
| Customer portal | `/portal/<token>` | Invoices for one owner and one customer |
| Portal invoice | `/portal/<token>/invoice/<invoiceNumber>` | One of those invoices |

An invoice token does not open the customer portal. Tokens are random bearer values. Only a SHA-256 hash is stored. A second HMAC, keyed with `BETTER_AUTH_SECRET`, binds the token to the access record. Links last 30 days and can be revoked. Expired, revoked, and unknown tokens fail closed.

Portal list, detail, PDF, and checkout all re-check that the invoice belongs to the portal’s `ownerId` and `customerId`. There are no customer passwords.

Public JSON omits `ownerId`, MongoDB ids, Stripe ids, and reminder metadata. Token routes set `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

## AI

```text
POST /api/assistant { question }
  → session user id
    → owner-scoped analytics DTO (size-capped)
      → one OpenAI call
        → schema-checked answer

GET /api/insights
  → deterministic insight cards (no model)

POST /api/insights
  → same cards, plus one optional executive summary
```

The model sees totals, period comparisons, top products and customers, receivables, and inventory signals. It does not receive raw documents, secrets, or a tool that can write. Answers are read-only. Timeout and output length are capped. Without `OPENAI_API_KEY`, cards still render and the model features stay unavailable.

Insight rules use a UTC last-30-days window unless noted: revenue change of at least 10% with at least 3 orders, any overdue balance, invoices due within 3 days, low or zero stock, at least 3 pending orders, a cancellation rate of at least 15% when there are at least 5 orders, and weak collection against outstanding receivables. At most five cards are returned.

The Free plan does not include the assistant or the AI summary. Deterministic insights remain available.

## Reminders and cron

Manual reminders are sent from an invoice. `GET` or `POST /api/cron/invoice-reminders` runs the batch. Vercel Cron calls that path daily at 09:00 UTC (`vercel.json`). The request must carry `CRON_SECRET` as `Authorization: Bearer` or `x-cron-secret`. Demo owners are skipped. Email still requires Resend.

## Deployment shape

Production expects `MONGODB_URI`, `MONGODB_DB`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `NEXT_PUBLIC_APP_URL`. Resend, Stripe, OpenAI, and `CRON_SECRET` are optional. Missing optional credentials degrade that integration only.

Response headers on all routes include `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and a locked-down Permissions-Policy. PDF routes include PDFKit font assets in the server trace so production PDF generation can find them.
