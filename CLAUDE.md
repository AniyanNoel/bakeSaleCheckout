@AGENTS.md

# Bake Sale Checkout: notes for Claude

A simple checkout for church sales, run by **one person (the cashier)**. Keep it simple: no roles, no volunteer
tracking, no IOU ledger. The owner (Noel) explicitly asked for "a checkout machine at a supermarket", not an intricate
system.

## How the sale works

- Food tables (stations) each have a letter: Indian food = A, Sweets = B. Items get codes A01, A02, B01.
- People at the tables write item codes on the buyer's paper slip. The cashier types the buyer's church **account
  number** (an ID from the church directory, e.g. Noel is 9; nobody signs in with it), then the codes.
- Each checkout is one record: Name, Account, Items purchased, Total, Form of payment (cash/Venmo/check), Paid yes/no.
- Unpaid checkouts get marked paid later on the Records page. Records download as Excel.

## Code map

- `src/db/schema.ts`: users/sessions (the one login), events, stations (tables), items, members (people: account
  number + name), checkouts + checkout_lines (prices copied at sale time), audit_log.
- `src/lib/services/*`: all database writes; each checks `assertCan` and writes an audit row in the same transaction.
- `src/lib/services/checkouts.ts`: submit (idempotent by clientId), list, totals, mark paid, delete.
- `src/app/(app)/events/[eventId]/checkout/checkout.tsx`: the checkout screen (client component, offline outbox in
  IndexedDB via `src/lib/client/outbox.ts`, service worker `public/sw.js`).
- Pages: `events/[eventId]/{checkout,records,items,price-sheet,import}`, `people`, `account`.
- Money is integer cents everywhere (`src/lib/money.ts`).

## Commands

- `npm run dev` (http://localhost:3000), `npm test`, `npx tsc --noEmit`, `npx eslint src tests`
- Schema change: edit `src/db/schema.ts`, `npm run db:generate`, commit the file in `drizzle/`, `npm run db:migrate`.
- `.env` holds `DATABASE_URL` (a Neon database). Never commit `.env` or real member data.

## Open questions (ask Noel, don't guess)

- Whether other church organizations should share one app or each get their own copy.
- Whether sign-up should be limited to `@stmtcdv.org` emails (asked for, not built yet: there is one login today).
