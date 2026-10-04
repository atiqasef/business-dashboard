# Ledger — Business Management Dashboard

A server-first Next.js business workspace for customers, products, orders, invoices, and payments.

## Stack

- Next.js 16 App Router + React 19 + TypeScript
- Tailwind CSS
- MongoDB (native driver)
- Better Auth
- Vitest + mongodb-memory-server

## Getting started

```bash
npm install
cp .env.example .env.local
# set BETTER_AUTH_SECRET, BETTER_AUTH_URL, NEXT_PUBLIC_APP_URL, MONGODB_URI, MONGODB_DB
# optional for invoice email: RESEND_API_KEY, EMAIL_FROM, EMAIL_FROM_NAME
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

Demo users can view customers, products, orders, invoices, payments, and dashboard metrics. All mutations remain blocked by `assertDemoWriteAllowed`.

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

## Security notes

- Owner scope always comes from the authenticated session
- Browser-supplied `ownerId` / `userId` are never trusted for authorization
- `.env.local`, `.vercel/`, and cookie jars are gitignored
- Demo provisioning never deletes normal users or non-demo business data
- Email provider secrets must never use `NEXT_PUBLIC_*` names

## Intentionally deferred

- Payment gateway integration
- Multi-currency
- Recurring invoices
- Automated invoice reminders
- Full double-entry accounting
