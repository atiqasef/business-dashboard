# Business Management SaaS

A production-oriented full-stack business management platform for managing customers, products, orders, invoices, payments, reporting, and business operations from a single dashboard.

The product name in the app is **Ledger**. It is a server-first Next.js application: the browser displays the workspace, and the server decides who owns the data, what a plan allows, and what an invoice balance is.

**Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, MongoDB, Better Auth, Stripe, Resend, OpenAI, Vitest, Vercel.

## Live demo

This repository does not store a production URL. The deployed origin is set with `NEXT_PUBLIC_APP_URL` on the host.

The login screen includes **Sign in as demo**. Those credentials are shown in the app on purpose:

- Email: `demo@businessdashboard.com`
- Password: `Demo@123456`

The demo is a read-only workspace with seeded customers, products, orders, invoices, and payments. Visitors can look through the product. They cannot create or edit records, record payments, send email, start Stripe Checkout, change billing, or complete onboarding writes.

## Project overview

Small operators usually keep customers in one place, orders in another, and invoices in a spreadsheet. Ledger is one workspace for that day-to-day billing work.

It is business software, not a generic CRUD sample. Orders become invoices. Payments change the outstanding balance. Customers can open a tokenized invoice or a customer portal without an account. Optional Stripe Checkout records money only after a verified webhook. A separate Stripe subscription flow can change the workspace plan. Reports, insights, and an optional AI assistant read the same server-calculated numbers.

## Key features

- Email and password authentication, with protected workspace routes
- Public read-only demo account
- Customers, products with stock, orders, invoices, and manual payments
- Server-generated invoice numbers and server-calculated totals
- Invoice PDFs
- Invoice email through Resend
- Scheduled and manual payment reminders
- Public single-invoice links and a separate customer invoice portal
- Stripe Checkout for an invoice’s outstanding balance
- Organizations with Free, Starter, Pro, and Business plans and entitlements
- Optional Stripe subscription billing, separate from customer invoice payments
- Dashboard analytics and reports
- Business profile and invoice branding in Settings
- Read-only AI Business Assistant
- Proactive business insights, with an optional AI executive summary
- First-run onboarding for empty workspaces

Email, Stripe, OpenAI, and the reminder cron are optional. If those credentials are missing, the rest of the app still runs and the affected feature shows a safe unavailable state.

## Screenshots

Screenshots can be added here to showcase the dashboard, invoices, reports, AI assistant, and customer portal.

## Architecture

```text
Browser
   ↓
Next.js App Router
   ↓
Server services
   ↓
MongoDB

External integrations (optional):
  Stripe          invoice Checkout and SaaS subscriptions
  Resend          invoice and reminder email
  OpenAI          assistant and insight summary
  Public portals  tokenized invoice and customer links
```

The UI is server-first. Route handlers and server services talk to MongoDB with the native driver. The signed-in user is the owner. Business documents are queried with that session owner. Financial totals, tax, and outstanding balances are calculated on the server. The browser cannot choose `ownerId`, `organizationId`, `planId`, or a payment amount.

A deeper request-flow write-up is in [docs/architecture.md](docs/architecture.md).

## SaaS model

```text
User
  ↓
Organization
  ↓
Plan / Entitlements
  ↓
Stripe Customer
  ↓
Subscription
```

Each user gets one organization. Business records (customers, products, orders, invoices, payments) stay scoped by `ownerId`, which is the Better Auth user id. `organizations.ownerUserId` maps to that same id. There is no team membership model and no organization switcher.

Plans are `free`, `starter`, `pro`, and `business`. The Free plan includes the core billing workspace. The AI assistant and the AI insight summary require a paid plan. Effective entitlements follow the subscription status: active, trialing, and past due keep the paid plan; a canceled subscription keeps it until the period ends; unpaid, incomplete, and paused fall back to Free. Unknown Stripe Price IDs never grant a paid plan.

Team members, role-based access, and switching between organizations are intentionally out of scope.

## Payments

Customer invoice payments and SaaS subscriptions are separate Stripe workflows. They share a webhook endpoint and an idempotency record. They do not share payment documents.

### Invoice payments

```text
Invoice
  ↓
Stripe Checkout
  ↓
Webhook
  ↓
Verified payment
  ↓
Invoice balance
```

Checkout uses Stripe `mode=payment` and a server-calculated outstanding amount in USD. The browser return URL (`?payment=success`) is only a message. A payment is recorded when `POST /api/webhooks/stripe` verifies the Stripe signature.

### SaaS subscription billing

```text
Organization
  ↓
Stripe Customer
  ↓
Subscription
  ↓
Plan
  ↓
Entitlements
```

Settings can start subscription Checkout (`mode=subscription`) or the Stripe billing portal. Price IDs come from `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, and `STRIPE_PRICE_BUSINESS`. The browser cannot send a price, a customer id, or a return URL.

Both flows verify webhook signatures against the raw body, store Stripe event ids so duplicates are ignored, and reclaim events stuck in processing after a two-minute lease. Invoice amounts and plan mapping stay on the server.

This repository’s automated tests mock Stripe. A live Stripe account is not claimed here.

## Security

Practical controls, not a certification:

- Session-derived ownership. APIs ignore a browser-supplied owner.
- Owner-scoped queries, so one account cannot read another account’s records.
- Demo mutations return a read-only error.
- Invoice totals, payment amounts, and outstanding balances are calculated on the server.
- Stripe webhooks require a valid signature. Event and payment ids are idempotent.
- Public invoice and portal links store a hash of the bearer token, expire, and can be revoked.
- Public responses omit owner ids, database ids, Stripe ids, and reminder internals.
- Private and tokenized responses use `Cache-Control: no-store`.
- Secrets stay in server environment variables.
- The AI provider receives a compact analytics summary, not raw database documents.

Details are in [docs/security.md](docs/security.md).

## Engineering highlights

- Server-first Next.js architecture
- Organization, plan, and entitlement foundation
- Server-side tenant isolation on the existing owner boundary
- Financial integrity controls, including atomic outstanding-balance reservation
- Stripe Checkout for invoices
- Stripe webhook signature checks and idempotency
- Separate SaaS subscription billing
- Tokenized public invoice and customer portals
- PDF invoices
- Email delivery
- Scheduled payment reminders
- Regression tests around auth, billing, portals, and tenancy
- Production security headers, health check, and no-store caching
- Read-only AI assistant with sanitized business context
- Proactive business insights
- First-run onboarding that does not trap existing workspaces

## Project status

This is a portfolio-grade, production-oriented SaaS implementation. It is suitable to deploy, demo, and review as an example of how the product is built.

It is not described here as a business with paying customers, and it does not claim an enterprise security certification. Automated tests cover Stripe and OpenAI with mocks. Live Stripe and live OpenAI calls are not claimed by this repository.

## Technology stack

### Frontend

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS 4
- Recharts

### Backend

- Next.js route handlers and server services
- MongoDB native driver
- MongoDB Atlas in production (local MongoDB is fine for development)

### Authentication

- Better Auth

### Payments

- Stripe Checkout and Stripe Billing

### Email

- Resend

### Documents

- PDFKit

### AI

- OpenAI, called only from the server. The default model is `gpt-4o-mini` unless `OPENAI_MODEL` is set.

### Testing

- Vitest
- mongodb-memory-server

### Deployment

- Vercel, including a daily cron for invoice reminders

## Testing

The suite is 188 tests in 26 files. Tests use an in-memory MongoDB and do not call live Stripe, Resend, or OpenAI.

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Also available: `npm run test:watch` and `npm run test:coverage`. This README does not publish a coverage percentage.

## Environment variables

Copy `.env.example` to `.env.local`. Never commit real values. Never put secrets in `NEXT_PUBLIC_*` variables.

**Required in production**

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string |
| `MONGODB_DB` | Database name |
| `BETTER_AUTH_SECRET` | Session signing and public-token HMAC |
| `BETTER_AUTH_URL` | Auth base URL |
| `NEXT_PUBLIC_APP_URL` | Public app origin (not a secret) |

**Optional.** The app runs without them. The related feature reports that it is not configured.

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Invoice and reminder email |
| `EMAIL_FROM` | Verified sender address |
| `EMAIL_FROM_NAME` | Sender name (defaults to Ledger) |
| `CRON_SECRET` | Authorizes `/api/cron/invoice-reminders` |
| `STRIPE_SECRET_KEY` | Invoice Checkout and SaaS billing |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification |
| `STRIPE_PRICE_STARTER` | Starter plan Price ID |
| `STRIPE_PRICE_PRO` | Pro plan Price ID |
| `STRIPE_PRICE_BUSINESS` | Business plan Price ID |
| `OPENAI_API_KEY` | Assistant and insight summary |
| `OPENAI_MODEL` | Optional model override |

`ALLOW_PRODUCTION_DEMO_PROVISION=1` is a one-off switch for `npm run provision:demo:production`. It is not required to run the app. Public link lifetime is a 30-day server constant, not an environment variable.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

On Windows PowerShell, copy the env file with `copy .env.example .env.local`.

Set the required variables before expecting auth and MongoDB to work. Optional integrations can stay empty.

Seed the local demo account only against a localhost MongoDB:

```bash
npm run provision:demo
```

The production login button provisions the same demo account idempotently. An offline production seed is:

```bash
ALLOW_PRODUCTION_DEMO_PROVISION=1 npm run provision:demo:production
```

Other scripts: `npm run build`, `npm start`, `npm run lint`, `npm test`.

`GET /api/health` is an unauthenticated readiness check. It returns MongoDB status and whether optional integrations are configured. It does not return secrets.

## Demo account

Sign in from the login page, or use the credentials in [Live demo](#live-demo).

Visitors can open the dashboard, customers, products, orders, invoices, payments, reports, notifications, settings, and deterministic insights. Invoice PDFs can be downloaded. The seeded organization is on the Free plan, so the AI assistant and AI insight summary stay on their upgrade-required state.

Writes are rejected. That includes creating or editing records, manual payments, voiding payments, public links, invoice email, reminders, Stripe Checkout, SaaS checkout, the billing portal, and saving onboarding or settings.

## Future scope

These are intentionally outside the current product, not missing pieces of the billing workspace:

- Team members, roles, and organization switching
- Additional payment providers
- Multi-currency
- A tax engine and double-entry accounting
- Deeper automation, including AI actions and retrieval over raw documents

## Further reading

- [Architecture](docs/architecture.md)
- [Security model](docs/security.md)
- [Environment template](.env.example)
