# Youth Bake Sale

Web app for running the church youth bake sale: items and codes, volunteer signups, checkout, payments and IOUs.
This is **phase 1 (Foundation)** from the design doc: accounts, roles, audit log, events, stations, items with codes,
importing last year's Google Sheet, volunteer signups, and printable bring lists and price sheets.
Checkout, payments and IOUs come in phase 2.

## Running it locally

You need Node.js 22 and a Postgres database (a free Neon or Supabase database works, or Postgres on your computer).

```bash
npm install
cp .env.example .env        # then set DATABASE_URL
npm run db:migrate          # creates the tables
npm run dev                 # http://localhost:3000
```

The first visit opens a one-time setup page to create the first admin. After that, admins add everyone else on the
**Users** page.

## Tests

```bash
npm test
```

Database tests need `TEST_DATABASE_URL` pointing at a separate, throwaway database whose name ends in `_test`.
They wipe it on every run.

## How things work

- **Database is the source of truth.** All changes go through `src/lib/services/*`, which check permissions and
  write an audit row in the same database transaction as the change.
- **Money is integer cents** everywhere (`src/lib/money.ts`).
- **Each year is its own event.** A new event can copy last year's stations and items (same codes and prices).
- **Item codes** are the station letter plus a number (A01, B03). They can be renumbered while the event is a draft.
  Opening the sale locks them so printed slips and price sheets stay correct. Prices can still change; completed sales
  (phase 2) will keep the price they were sold at.
- **Removing items:** allowed while the event is a draft. Once the sale is open, items are marked inactive instead.
- **Closed events are read-only** until an admin reopens them.
- **Signups:** any number of volunteers per item. 1 to 100 is normal; larger needs a "large quantity" tick.
- **Logins:** passwords are hashed with bcrypt; 5 wrong tries locks the account for 5 minutes; a session lasts 14 hours.
  Changing someone's role, deactivating them or resetting their password signs them out everywhere.

### Importing last year's sheet

In Google Sheets choose **File > Download > Microsoft Excel (.xlsx)** and upload it on the event's **Import** page.
Any tab with an "Item" column is read. You see a preview first and nothing is saved until you confirm.

- When tabs disagree on quantity (the 2025 Sign Up and Finance tabs do), you choose which one to use.
- Blank or $0 prices are imported as-is and flagged, never guessed.
- Volunteer cells like `Name (3)` become signups. A name with no number is kept with an unknown quantity and flagged.
- A "Total" row ends a table, so side tables under it (like the 2025 pizza pricing notes) are not imported.
- The IOU table on the Finance tab is never imported.
- Items whose name already exists in the event are skipped, so importing twice is safe.

## Roles

| | Admin | Cashier | Volunteer |
|---|---|---|---|
| Events, stations, items, prices, import | Yes | | |
| Volunteer signups, bring list | Yes | | |
| View items and price sheet | Yes | Yes | Yes |
| Users and audit log | Yes | | |

Checkout and payment permissions arrive with phase 2.

## Tech

Next.js 16 (App Router, server actions), TypeScript, Tailwind CSS, Postgres with Drizzle ORM, Vitest.
Schema changes: edit `src/db/schema.ts`, run `npm run db:generate`, commit the new file in `drizzle/`, then
`npm run db:migrate`.
