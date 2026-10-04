# Security model

This document describes controls that exist in the application. It is not a penetration-test report and it does not claim a certification.

## Authentication

Workspace pages require a Better Auth session cookie. Middleware redirects anonymous visitors to `/login`, except `/login`, `/register`, `/invoice/*`, and `/portal/*`.

API routes are not gated by that middleware. Each handler loads the session itself. Unauthenticated mutations and private reads fail. `/api/health` and the public token routes are the intentional exceptions. The Stripe webhook authenticates with a signature, not a session. The reminder cron authenticates with `CRON_SECRET`.

## Authorization

The owner id is `session.user.id`. Handlers do not accept an owner, user, organization, or plan from the request body for authorization.

Reads and writes add that owner to the query. Another account’s id returns the same style of not-found or forbidden response used for a missing record. Public error text does not include stack traces, connection strings, or other tenants’ data.

## Owner isolation

Customers, products, orders, invoices, payments, reminders, business profile, reports, insights, and the assistant all run inside the session owner. Invoice creation checks that the order and its customer and products belong to that owner. Portal checkout checks the invoice against the portal’s owner and customer, not against an email address alone.

Organizations are one per user (`ownerUserId`). They do not grant access to another user’s business documents.

## Demo protection

The demo account is a real user with a read-only role. `assertDemoWriteAllowed` rejects mutations with HTTP 403 and the message `Demo account is read-only`.

That covers create and update of customers, products, orders, invoices, and payments; voiding payments; public invoice and portal links; invoice email; reminders; SaaS checkout and the billing portal; business profile saves; and persisting onboarding completion. Demo invoices cannot open Stripe Checkout. The reminder cron does not email the demo owner.

The demo can still read the seeded workspace, including PDFs. The seeded organization is on the Free plan, so paid AI features stay unavailable. The UI does not pretend a blocked action succeeded.

Demo provisioning inserts or updates only the reserved demo fixtures. It does not delete other users’ data.

## Financial integrity

- Order and invoice totals are computed on the server from owned line items.
- A manual payment must be positive and no greater than the outstanding balance.
- An atomic outstanding-balance reservation rejects concurrent overpayment.
- Invoice status is derived from amounts, due date, and cancellation. It is not trusted from the browser.
- Stripe Checkout charges the server’s current outstanding balance in USD.
- A browser redirect after Checkout does not create a payment.
- Stripe-recorded payments are not voided in the application.

Currency is USD. There is no tax engine and no in-app refund flow.

## Stripe webhooks

`POST /api/webhooks/stripe` reads the raw body and verifies `stripe-signature` with `STRIPE_WEBHOOK_SECRET`. A bad signature returns 400. Missing Stripe configuration returns 503. The response uses `Cache-Control: no-store`.

Processing is idempotent:

- Each Stripe event id is unique. A finished event is ignored.
- An event stuck in `processing` is left alone for two minutes, then may be reclaimed.
- A failed event can be retried.
- A Stripe PaymentIntent cannot be stored twice (`provider` + `providerPaymentId`).

Invoice Checkout (`mode=payment`, context `invoice_checkout_v1`) and SaaS Checkout (`mode=subscription`, context `saas_subscription_v1`) are dispatched separately. A subscription invoice event does not record a customer invoice payment. A customer invoice event does not change the plan.

SaaS Price IDs are read from server environment variables. A price the server does not recognize does not grant Starter, Pro, or Business. Checkout and portal return URLs are built on the server. Client-supplied price, customer, organization, and return URL fields are ignored.

Webhook logs record the error name, not the secret or the raw payload.

## Public tokens

Invoice links and customer portal links are different records.

- The value in the URL is a bearer token. The database stores its SHA-256 hash, not the raw token.
- Token material is also bound with an HMAC-SHA256 keyed by `BETTER_AUTH_SECRET`.
- Links expire after 30 days.
- Revocation sets `revokedAt`. Later list, detail, PDF, and checkout calls fail.
- Regenerating a link revokes the previous active token.
- Invalid, expired, and revoked tokens do not reveal whether some other invoice exists.

Public DTOs leave out `ownerId`, MongoDB ids, Stripe ids, auth metadata, and reminder metadata.

Because the token is in the path, those pages and APIs send `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.

## Customer portal

The portal lists invoices for one `ownerId` plus one `customerId`. It does not search by email across owners. An invoice number in the portal URL still has to belong to that pair. Portal PDF and portal Checkout use the same check. There is no customer user account.

## Caching

Authenticated JSON, onboarding, billing, webhooks, cron, health, and public token responses set `Cache-Control: no-store`. Tokenized pages are not meant to be stored by shared caches.

Application-wide headers are `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and a Permissions-Policy that disables camera, microphone, and geolocation. Token routes replace the referrer policy with `no-referrer`.

## Secrets

Required production secrets and connection strings are server environment variables: `MONGODB_URI`, `MONGODB_DB`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`. `NEXT_PUBLIC_APP_URL` is the public origin only.

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`, `RESEND_API_KEY`, `OPENAI_API_KEY`, and `CRON_SECRET` are read on the server. They are not given `NEXT_PUBLIC_` names. Health and other APIs report whether an integration is configured. They do not return the values.

`.env.local` is gitignored. `.env.example` contains empty placeholders.

## AI data

The assistant and the insight summary send one compact JSON context built from owner-scoped aggregates: period totals, comparisons, top entities, receivables, and stock signals. The context is length-capped. Raw MongoDB documents are not the prompt.

The model cannot create orders, send email, or call Stripe. Provider failures become a safe unavailable or error response. The Free plan blocks the assistant and the AI summary even when a key is present. Deterministic insight cards do not call OpenAI.

Automated tests stub the provider. They do not use a live key.

## What this does not include

- Team roles or per-member permissions
- Customer accounts
- A formal audit log
- In-app Stripe refunds
- Persistent per-user AI rate limits
- A claim that the system is immune to every vulnerability

Those items are either deferred or outside the current product.
