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
npm run dev
```

Optional local demo seed (local Mongo only):

```bash
npm run provision:demo
```

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
```

## Security notes

- Owner scope always comes from the authenticated session
- Browser-supplied `ownerId` / `userId` are never trusted for authorization
- `.env.local`, `.vercel/`, and cookie jars are gitignored

## Intentionally deferred

- PDF invoice generation
- Email delivery
- Payment gateway integration
- Multi-currency
- Recurring invoices
- Full double-entry accounting
