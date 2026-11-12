import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Staff accounts, sessions and the audit trail
// ---------------------------------------------------------------------------

export const userRole = pgEnum("user_role", ["admin", "cashier", "volunteer"]);

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    // Always stored lower-cased so logins are case-insensitive.
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRole("role").notNull(),
    active: boolean("active").notNull().default(true),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_key").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    // SHA-256 of the random token held in the browser cookie. The raw token is
    // never stored, so a database leak does not hand out live sessions.
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: integer("user_id").references(() => users.id),
    action: text("action").notNull(),
    tableName: text("table_name").notNull(),
    rowId: text("row_id"),
    eventId: integer("event_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_event_idx").on(t.eventId), index("audit_at_idx").on(t.at)],
);

// ---------------------------------------------------------------------------
// Events (one per year), stations and the item catalog
// ---------------------------------------------------------------------------

export const eventStatus = pgEnum("event_status", ["draft", "open", "closed"]);

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // Left empty until the date is decided.
  saleDate: date("sale_date"),
  status: eventStatus("status").notNull().default("draft"),
  copiedFromEventId: integer("copied_from_event_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stations = pgTable(
  "stations",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // The letter(s) item codes at this station start with, e.g. "A" for A01.
    codePrefix: text("code_prefix").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    unique("stations_event_prefix_key").on(t.eventId, t.codePrefix),
    unique("stations_event_name_key").on(t.eventId, t.name),
    check("stations_prefix_format", sql`${t.codePrefix} ~ '^[A-Z]{1,2}$'`),
  ],
);

export const items = pgTable(
  "items",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    category: text("category"),
    unit: text("unit").notNull().default("each"),
    // Integer cents. NULL means "price not set yet" and is flagged in the UI.
    unitPriceCents: integer("unit_price_cents"),
    // Planning number (what we budget for). NULL means unknown / TBD.
    expectedQty: integer("expected_qty"),
    // How many are actually on hand to sell. NULL means not counted yet.
    availableQty: integer("available_qty"),
    stationId: integer("station_id").references(() => stations.id, { onDelete: "set null" }),
    active: boolean("active").notNull().default(true),
    // Links an item to the one it was copied from in an earlier event.
    sourceItemId: integer("source_item_id"),
    importNote: text("import_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("items_event_code_key").on(t.eventId, t.code),
    index("items_station_idx").on(t.stationId),
    check("items_price_nonneg", sql`${t.unitPriceCents} IS NULL OR ${t.unitPriceCents} >= 0`),
    check("items_expected_nonneg", sql`${t.expectedQty} IS NULL OR ${t.expectedQty} >= 0`),
    check("items_available_nonneg", sql`${t.availableQty} IS NULL OR ${t.availableQty} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Volunteers (bakers) and what they signed up to bring
// ---------------------------------------------------------------------------

export const volunteers = pgTable(
  "volunteers",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    // Personal information: only admins can see or edit these.
    phone: text("phone"),
    email: text("email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("volunteers_name_idx").on(sql`lower(${t.name})`)],
);

export const signups = pgTable(
  "signups",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    volunteerId: integer("volunteer_id")
      .notNull()
      .references(() => volunteers.id),
    // NULL when an imported signup had no readable quantity; flagged in the UI.
    committedQty: integer("committed_qty"),
    deliveredQty: integer("delivered_qty"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("signups_item_idx").on(t.itemId),
    index("signups_volunteer_idx").on(t.volunteerId),
    check("signups_committed_positive", sql`${t.committedQty} IS NULL OR ${t.committedQty} >= 1`),
    check("signups_delivered_nonneg", sql`${t.deliveredQty} IS NULL OR ${t.deliveredQty} >= 0`),
  ],
);

export type User = typeof users.$inferSelect;
export type Role = (typeof userRole.enumValues)[number];
export type Event = typeof events.$inferSelect;
export type EventStatus = (typeof eventStatus.enumValues)[number];
export type Station = typeof stations.$inferSelect;
export type Item = typeof items.$inferSelect;
export type Volunteer = typeof volunteers.$inferSelect;
export type Signup = typeof signups.$inferSelect;

// ---------------------------------------------------------------------------
// Phase 2: members, sales, payments and corrections
// Financial rows are append-only: corrections are new rows, nothing is deleted.
// ---------------------------------------------------------------------------

export const members = pgTable(
  "members",
  {
    id: serial("id").primaryKey(),
    // Format not decided yet, so any text is accepted. Stored trimmed and upper-cased.
    accountNumber: text("account_number").notNull(),
    name: text("name").notNull(),
    // Created by a cashier at checkout and not yet confirmed by an admin.
    provisional: boolean("provisional").notNull().default(false),
    active: boolean("active").notNull().default(true),
    // Personal information: admins only.
    phone: text("phone"),
    email: text("email"),
    contactConsent: boolean("contact_consent").notNull().default(false),
    contactConsentNote: text("contact_consent_note"),
    createdBy: integer("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("members_account_key").on(t.accountNumber)],
);

export const transactionStatus = pgEnum("transaction_status", ["completed", "voided"]);

export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    // Made by the browser before the first send. A repeat with the same id
    // returns the original sale instead of recording a second one.
    clientId: text("client_id").notNull(),
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id),
    memberId: integer("member_id").references(() => members.id),
    customerName: text("customer_name").notNull(),
    status: transactionStatus("status").notNull().default("completed"),
    // Sum of the lines (item sales only).
    totalCents: integer("total_cents").notNull(),
    // Overpayment the customer chose to leave as a gift. Kept apart from sales.
    donationCents: integer("donation_cents").notNull().default(0),
    // Things an admin should look at: price changed, oversold, inactive item, possible duplicate.
    flags: jsonb("flags").$type<string[]>().notNull().default([]),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    deviceId: text("device_id"),
    // When the cashier pressed Complete (may be earlier than createdAt if it was sent after a Wi-Fi drop).
    soldAt: timestamp("sold_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("transactions_client_key").on(t.clientId),
    index("transactions_event_idx").on(t.eventId),
    index("transactions_member_idx").on(t.memberId),
    check("transactions_total_nonneg", sql`${t.totalCents} >= 0`),
    check("transactions_donation_nonneg", sql`${t.donationCents} >= 0`),
  ],
);

export const transactionLines = pgTable(
  "transaction_lines",
  {
    id: serial("id").primaryKey(),
    transactionId: integer("transaction_id")
      .notNull()
      .references(() => transactions.id),
    itemId: integer("item_id").references(() => items.id),
    // Copied at sale time so later edits to the item never change history.
    itemCode: text("item_code").notNull(),
    itemName: text("item_name").notNull(),
    stationName: text("station_name"),
    unitPriceCents: integer("unit_price_cents").notNull(),
    quantity: integer("quantity").notNull(),
    lineTotalCents: integer("line_total_cents").notNull(),
    // For a "Misc" line with no catalog item.
    note: text("note"),
  },
  (t) => [
    index("lines_transaction_idx").on(t.transactionId),
    index("lines_item_idx").on(t.itemId),
    check("lines_qty_positive", sql`${t.quantity} >= 1`),
    check("lines_price_nonneg", sql`${t.unitPriceCents} >= 0`),
  ],
);

export const paymentMethod = pgEnum("payment_method", ["cash", "venmo", "check"]);
export const paymentStatus = pgEnum("payment_status", ["received", "pending", "cleared", "bounced"]);

export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    transactionId: integer("transaction_id")
      .notNull()
      .references(() => transactions.id),
    memberId: integer("member_id").references(() => members.id),
    method: paymentMethod("method").notNull(),
    // Negative when money goes back to the customer (void or refund).
    amountCents: integer("amount_cents").notNull(),
    // Check number, Venmo handle or note.
    reference: text("reference"),
    // Cash is "received" (counts as in hand). Venmo and checks start "pending"
    // until an admin confirms them; a bounced check stops counting.
    status: paymentStatus("status").notNull(),
    receivedBy: integer("received_by")
      .notNull()
      .references(() => users.id),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    clearedBy: integer("cleared_by").references(() => users.id),
    // Set for a later IOU payment (as opposed to one taken at checkout).
    settlementId: text("settlement_id"),
    note: text("note"),
  },
  (t) => [
    index("payments_transaction_idx").on(t.transactionId),
    index("payments_member_idx").on(t.memberId),
    check("payments_amount_nonzero", sql`${t.amountCents} <> 0`),
  ],
);

export const adjustmentKind = pgEnum("adjustment_kind", ["void", "refund", "write_off"]);

export const adjustments = pgTable(
  "adjustments",
  {
    id: serial("id").primaryKey(),
    transactionId: integer("transaction_id")
      .notNull()
      .references(() => transactions.id),
    kind: adjustmentKind("kind").notNull(),
    // Negative: lowers what the customer owes.
    amountCents: integer("amount_cents").notNull(),
    reason: text("reason").notNull(),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("adjustments_transaction_idx").on(t.transactionId), check("adjustments_amount_negative", sql`${t.amountCents} < 0`)],
);

export type Member = typeof members.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type TransactionLine = typeof transactionLines.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type PaymentMethod = (typeof paymentMethod.enumValues)[number];
export type Adjustment = typeof adjustments.$inferSelect;
