# Ledger — Business Management Dashboard

A server-first Next.js business workspace for customers, products, orders, invoices, and payments.

## Stack

- Next.js 16 App Router + React 19 + TypeScript
- Tailwind CSS
- MongoDB (native driver)
- Better Auth
- Stripe Checkout (optional, server-side)
- Vitest + mongodb-memory-server

## Getting started

```bash
npm install
cp .env.example .env.local
# set BETTER_AUTH_SECRET, BETTER_AUTH_URL, NEXT_PUBLIC_APP_URL, MONGODB_URI, MONGODB_DB
# optional for invoice email: RESEND_API_KEY, EMAIL_FROM, EMAIL_FROM_NAME
# optional for online invoice payments: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
npm run dev
```

### Demo account

The login page exposes a public read-only demo account (`demo@businessdashboard.com`).

- **Local seed** (localhost Mongo only):

```bash
npm run provision:demo
```

- **Production**: the “Sign in as demo” button also runs an idempotent server-side provision against the app’s configured MongoDB, then signs in and lands on `/`. Optional offline provision against Atlas:

```bash
# requires MONGODB_URI for the target database
ALLOW_PRODUCTION_DEMO_PROVISION=1 npm run provision:demo:production
```

Demo users can view customers, products, orders, invoices, payments, and dashboard metrics. All mutations remain blocked by `assertDemoWriteAllowed`. Demo invoices cannot create Stripe Checkout sessions.

### Auth landing

Successful email/password login and demo login redirect to `/` (the live dashboard). `/dashboard` is a legacy welcome route and redirects authenticated users to `/`.

## Core workflow

```text
Customer → Order → Invoice → Payment
```

### Orders

Orders represent what a customer purchased. Totals are calculated server-side.

### Invoices

- Created from an owned order via `POST /api/invoices` with `{ orderId, tax?, dueDate?, notes?, issue? }`
- One active invoice per order (cancelled invoices do not block a new one)
- Invoice numbers are generated server-side as `INV-YYYY-000001` using an atomic per-owner counter
- Totals (`subtotal`, `discount`, `tax`, `total`) are computed on the server from order data
- Statuses: `draft`, `issued`, `partially_paid`, `paid`, `overdue`, `cancelled`
- Issued invoices with payments cannot be cancelled; cancel is preferred over hard delete
- Download a professional PDF via `GET /api/invoices/:id/pdf` (owner-scoped, read-only; demo users may download)
- Email the same PDF via `POST /api/invoices/:id/email` to the owned customer's server-side email (demo cannot send)
- Share a secure single-invoice link via `/invoice/<token>` (token hash stored server-side)
- Share a separate customer portal link via `/portal/<token>` for that customer's invoice history (does not broaden invoice-only links)

### Invoice email (Resend)

1. Create a [Resend](https://resend.com) account and API key
2. Verify a sending domain (or use Resend's onboarding sender for development)
3. Set in Vercel / `.env.local`:

```bash
RESEND_API_KEY=re_...
EMAIL_FROM=invoices@your-verified-domain.com
EMAIL_FROM_NAME=Ledger
```

The app builds without these variables. Sending fails at runtime with a clear configuration error until they are set. Demo accounts cannot send email.

### Payments

- Created via `POST /api/payments` against an owned invoice
- Amount must be positive and cannot exceed outstanding balance
- Concurrent overpayment is guarded with an atomic outstanding-balance reservation
- Payments are not hard-deleted; use void (`DELETE /api/payments/:id`) to reverse them and recalculate invoice status
- Demo users can view invoices/payments but cannot mutate them

### Customer portal (token-based)

Phase 14 adds a **separate** customer portal access model from the single-invoice link:

| Link type | URL | Scope |
|---|---|---|
| Invoice access | `/invoice/<token>` | One invoice only |
| Customer portal | `/portal/<token>` | All invoices for `ownerId + customerId` |

Invoice-only tokens **do not** unlock the portal. Portal tokens are created from invoice detail → **Customer portal → Create Portal Link**.

Security notes:

- Bearer tokens are hashed at rest (same cryptographic approach as invoice access)
- Boundary is `ownerId + customerId` (not email alone)
- TTL matches invoice access (30 days)
- Revocation immediately invalidates list/detail/PDF/checkout for that portal
- No customer accounts, passwords, or Better Auth customer users in this phase
- Public responses never include `ownerId`, Mongo IDs, or payment/reminder internals

Portal invoice detail: `/portal/<token>/invoice/<invoiceNumber>`  
Portal PDF/checkout APIs validate the invoice belongs to the portal customer context before acting.

### Stripe Checkout (optional)

Online invoice payments use **Stripe Checkout** + a **verified webhook**.

```text
Public invoice token
  → POST /api/public/invoices/[token]/checkout
  → Stripe Checkout Session (server-calculated outstanding amount, USD)
  → Customer pays on Stripe
  → POST /api/webhooks/stripe (signature-verified)
  → Existing payment recording engine
  → Invoice outstanding/status update
```

**Security rule:** the browser success redirect (`?payment=success`) is UX only. It never records a payment. Only a signature-verified Stripe webhook can create an online payment.

#### Setup (test mode)

1. Create a Stripe account and open [test API keys](https://dashboard.stripe.com/test/apikeys)
2. Set server-only env vars (never `NEXT_PUBLIC_*`):

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

3. Local webhook forwarding:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Use the webhook signing secret printed by `stripe listen` as `STRIPE_WEBHOOK_SECRET`.

4. Production: add an endpoint in the Stripe Dashboard pointing to:

```text
https://your-domain.com/api/webhooks/stripe
```

Subscribe at least to `checkout.session.completed`.

#### Behavior notes

- Currency is USD for this phase (multi-currency deferred)
- Only card Checkout is enabled (immediate confirmation). Async methods are not enabled
- Checkout amount always equals the invoice’s current outstanding balance (server-side)
- Duplicate Stripe events / PaymentIntents are idempotent (`stripe-events.eventId` unique + `payments.provider+providerPaymentId` unique)
- If Stripe env vars are missing, the app still builds/runs; checkout returns a safe `503`
- Demo-owned invoices cannot start Checkout

### Dashboard metrics

- **Order revenue**: sum of non-cancelled order totals (existing Phase 3 meaning)
- **Collected payments**: sum of `paidAmount` on non-cancelled invoices
- **Outstanding receivables**: sum of invoice outstanding balances
- **Overdue invoices**: invoices past due with remaining balance

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm test
npm run test:watch
npm run test:coverage
npm run provision:demo
npm run provision:demo:production
```

### AI Business Assistant (read-only)

Authenticated owners can ask natural-language questions at `/assistant` (also in the sidebar as **AI Assistant**).

```text
POST /api/assistant { question }
  → session.user.id
  → owner-scoped dashboard/reports analytics (sanitized DTO)
  → OpenAI (server-only)
  → schema-validated answer
```

Setup:

```bash
OPENAI_API_KEY=sk-...
# optional
OPENAI_MODEL=gpt-4o-mini
```

Security model:

- Server-only provider; never use `NEXT_PUBLIC_*` for AI secrets
- Owner identity comes only from the session (browser `ownerId` ignored)
- Model receives compact sanitized analytics — not raw Mongo documents
- Read-only: no create/update/void/email/reminder/Stripe actions
- Demo users may ask questions about demo data only
- Private responses use `Cache-Control: no-store`
- Without `OPENAI_API_KEY`, the app still runs and the UI shows “not configured”
- Period windows reuse Reports UTC date-range logic (`last_7_days`, `last_30_days`, calendar this/last month, etc.)
- Answers must distinguish facts vs interpretations vs recommendations
- Provider timeout ~25s, `max_tokens` capped, one provider call per request
- Persistent per-user rate limiting remains deferred

Supported question themes: business summary, revenue/period comparison, top products/customers, outstanding/overdue invoices, follow-ups, inventory signals, attention/risk prompts.

Automated tests mock the AI provider and never call OpenAI. Live OpenAI smoke verification requires a real `OPENAI_API_KEY` and is not claimed unless that key is present.

### Business Insights (proactive, read-only)

The Dashboard shows **Business Insights** derived from the same owner-scoped analytics used by the assistant.

```text
GET  /api/insights
  → session.user.id
  → authoritative analytics context
  → deterministic insight cards (no OpenAI)

POST /api/insights
  → session.user.id
  → recompute deterministic insights
  → optional one-shot AI executive summary (OpenAI only if configured)
```

Deterministic rules (UTC last-30-days window unless noted):

| Signal | Threshold |
| --- | --- |
| Revenue decline / growth | ≥ 10% change vs previous comparable period; requires ≥ 3 orders in period |
| Overdue receivables | Any overdue invoice with outstanding balance |
| Due soon | Unpaid invoices due within reminder window (`DUE_SOON_WINDOW_DAYS`, currently 3) |
| Low stock | Existing product low/out-of-stock inventory rules |
| Pending orders | ≥ 3 pending orders (medium at ≥ 8) |
| Cancellation signal | ≥ 15% cancelled when ≥ 5 orders |
| Payment collection | Outstanding ≥ 25% of total invoiced, with overdue or weak collections |

At most 5 insights are shown, sorted by severity (`high` → `medium` → `info`). Weak/noisy signals are suppressed rather than shown as confident trends.

AI executive summary:

- Optional button on the Dashboard (not auto-called on every page load)
- One provider call maximum; summarizes already-computed insight DTOs only
- If `OPENAI_API_KEY` is missing, insight cards still work; summary stays unavailable
- AI never mutates business data and never invents authoritative financial totals

Demo accounts may view insights/summaries for demo data only (no mutations, emails, payments, or settings changes).

### Required environment variables (Vercel)

Set these in the Vercel project (values are never committed):

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL` (production site origin)
- `NEXT_PUBLIC_APP_URL` (same production origin)
- `MONGODB_URI`
- `MONGODB_DB`
- `RESEND_API_KEY` (invoice email)
- `EMAIL_FROM` (verified sender address)
- `EMAIL_FROM_NAME` (optional display name)
- `CRON_SECRET` (invoice reminder cron)
- `STRIPE_SECRET_KEY` (optional online payments)
- `STRIPE_WEBHOOK_SECRET` (optional online payments)
- `OPENAI_API_KEY` (optional AI assistant)
- `OPENAI_MODEL` (optional; defaults to `gpt-4o-mini`)

## Security notes

- Owner scope always comes from the authenticated session
- Browser-supplied `ownerId` / `userId` are never trusted for authorization
- Public invoice / customer portal access uses hashed bearer tokens (not Mongo IDs)
- Invoice-only tokens and customer portal tokens are separate capabilities
- Public token URLs use `Referrer-Policy: no-referrer` and `Cache-Control: no-store`
- Stripe Checkout Sessions are expired when a new session is created for the same invoice
- Stripe-recorded payments cannot be voided in-app (use Stripe refunds)
- Stripe webhook events stuck in `processing` are reclaimed after a short lease
- Demo owners are skipped by the reminder cron (no automated emails / link creation)
- `MONGODB_URI` and `BETTER_AUTH_SECRET` are required in production
- Stripe / Resend / cron secrets must never use `NEXT_PUBLIC_*` names
- See `.env.example` for the full variable list (values never committed)
- `.env.local`, `.vercel/`, and cookie jars are gitignored
- Demo provisioning never deletes normal users or non-demo business data

## Intentionally deferred

- AI mutation tools / autonomous agents / autonomous insight actions
- Persistent AI chat history / vector RAG
- Configurable insight thresholds UI
- Persistent per-user AI rate limiting service
- PayPal / Paddle / Stripe Connect
- Subscriptions / recurring billing
- Multi-currency
- Tax engine
- Refunds / disputes UI
- Customer accounts / portal dashboard
- Full double-entry accounting
