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
