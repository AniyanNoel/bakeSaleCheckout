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

export type User = typeof users.$inferSelect;
export type Role = (typeof userRole.enumValues)[number];
export type Event = typeof events.$inferSelect;
export type EventStatus = (typeof eventStatus.enumValues)[number];
export type Station = typeof stations.$inferSelect;
export type Item = typeof items.$inferSelect;

// ---------------------------------------------------------------------------
// People (church directory: account number + name)
// ---------------------------------------------------------------------------

export const members = pgTable(
  "members",
  {
    id: serial("id").primaryKey(),
    // The church account number, e.g. "9". Stored trimmed and upper-cased.
    accountNumber: text("account_number").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("members_account_key").on(t.accountNumber)],
);

export const paymentMethod = pgEnum("payment_method", ["cash", "venmo", "check"]);

/**
 * One checkout = one receipt: who bought, what, the total, how they paid and
 * whether they have paid yet.
 */
export const checkouts = pgTable(
  "checkouts",
  {
    id: serial("id").primaryKey(),
    // Made by the browser before the first send. Sending the same checkout twice
    // (double click, retry after a Wi-Fi drop) returns the first one.
    clientId: text("client_id").notNull(),
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    memberId: integer("member_id").references(() => members.id, { onDelete: "set null" }),
    // Copied at checkout so the record reads the same even if the directory changes.
    accountNumber: text("account_number"),
    customerName: text("customer_name").notNull(),
    totalCents: integer("total_cents").notNull(),
    paymentMethod: paymentMethod("payment_method"),
    paid: boolean("paid").notNull().default(false),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    note: text("note"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    // When Save was pressed (earlier than createdAt if it was sent after a Wi-Fi drop).
    soldAt: timestamp("sold_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("checkouts_client_key").on(t.clientId),
    index("checkouts_event_idx").on(t.eventId),
    index("checkouts_member_idx").on(t.memberId),
    check("checkouts_total_nonneg", sql`${t.totalCents} >= 0`),
  ],
);

export const checkoutLines = pgTable(
  "checkout_lines",
  {
    id: serial("id").primaryKey(),
    checkoutId: integer("checkout_id")
      .notNull()
      .references(() => checkouts.id, { onDelete: "cascade" }),
    itemId: integer("item_id").references(() => items.id, { onDelete: "set null" }),
    // Copied at checkout so a later price change never changes a past receipt.
    itemCode: text("item_code").notNull(),
    itemName: text("item_name").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    quantity: integer("quantity").notNull(),
    lineTotalCents: integer("line_total_cents").notNull(),
  },
  (t) => [
    index("checkout_lines_checkout_idx").on(t.checkoutId),
    check("checkout_lines_qty_positive", sql`${t.quantity} >= 1`),
    check("checkout_lines_price_nonneg", sql`${t.unitPriceCents} >= 0`),
  ],
);

export type Member = typeof members.$inferSelect;
export type Checkout = typeof checkouts.$inferSelect;
export type CheckoutLine = typeof checkoutLines.$inferSelect;
export type PaymentMethod = (typeof paymentMethod.enumValues)[number];
