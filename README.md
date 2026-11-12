# Bake Sale Checkout

A simple checkout for church sales, like a supermarket register. One person (the cashier) signs in.

1. **Before the sale:** add a table for each food station (Indian food = A, Sweets = B…) and its items with prices.
   Each item gets a code (A01, A02, B01…). Print the **Code sheet** for the tables.
2. **During the sale:** the people at each table write codes on the buyer's slip. At checkout you type the buyer's church
   account number (the name fills in), then the codes from the slip. Pick Cash, Venmo or Check, and whether they paid.
   Save, and the next customer is ready.
3. **After the sale:** **Records** lists every checkout (name, account, items, total, form of payment, paid yes/no)
   with totals. Mark people paid later, and download everything as an Excel file.

## Running it on your computer

You need [Node.js](https://nodejs.org) (the LTS version) and a Postgres database. A free [Neon](https://neon.tech)
project works.

```bash
npm install
cp .env.example .env        # then put your Neon connection string after DATABASE_URL=
npm run db:migrate          # creates or updates the tables; run it again after every git pull
npm run dev                 # open http://localhost:3000
```

The first visit asks you to create the login. To change a forgotten password:

```bash
npm run reset-password -- you@example.com "a new password"
```

## Using it

- **Items:** add tables, then items under them. Leave the code blank to get the next one (A01, A02…). Codes and prices
  can change at any time. A saved checkout keeps the price and code it was sold with. "Renumber codes" tidies them up
  before you print the code sheet.
- **Import items:** upload last year's Google Sheet (File > Download > Microsoft Excel) to bring in item names and
  prices.
- **People:** the church directory. Load an Excel or CSV file with `Account` and `Name` columns (or `First name` and
  `Last name`). Loading it again is safe. A new account number typed at checkout, with a name, is added here
  automatically.
- **Checkout** is keyboard-first: account number, Enter, item codes (`A1`, `A01`, `A1 3` for three), Enter on an empty
  box, then Enter for Cash (arrow keys to Venmo or Check, or press 1, 2, 3), and Enter to save. Ctrl+Enter saves from anywhere.
- **Wi-Fi drops are fine.** Each checkout is saved on the computer first, then sent. The page shows "waiting to send"
  until it gets through. Once opened online, the checkout page also reopens with no connection. Sending the same checkout
  twice (double-click, retry) only records it once.
- **Records:** search by name or account number, show only "Not paid yet", edit a checkout to mark it paid or change the
  payment, or delete one rung up by mistake. Every change is kept in the audit log table.

## Tests

```bash
npm test
```

Database tests need `TEST_DATABASE_URL` pointing at a separate, throwaway database whose name ends in `_test`. They wipe
it on every run.

## Tech

Next.js 16 (App Router, server actions), TypeScript, Tailwind CSS, Postgres with Drizzle ORM, Vitest. Money is stored
in integer cents. Schema changes: edit `src/db/schema.ts`, run `npm run db:generate`, commit the new file in `drizzle/`,
then `npm run db:migrate`.
