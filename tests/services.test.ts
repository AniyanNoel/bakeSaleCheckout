import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { auditLog, items, signups, users } from "@/db/schema";
import { buildImportPreview } from "@/lib/import/parse";
import type { Actor } from "@/lib/permissions";
import { createEvent, setEventStatus, updateEvent } from "@/lib/services/events";
import { applyImport } from "@/lib/services/import";
import { createItem, deleteItem, listItems, renumberCodes, updateItem } from "@/lib/services/items";
import { createStation, deleteStation } from "@/lib/services/stations";
import { addSignup, bringList, updateSignup } from "@/lib/services/signups";
import {
  createFirstAdmin,
  createSession,
  createUser,
  deleteSession,
  findSessionUser,
  updateUser,
  verifyLogin,
} from "@/lib/services/users";
import { financeSheet, signupSheet } from "./fixtures";
import { freshDb } from "./db-helpers";

let db: Db;
let close: () => Promise<void>;
let admin: Actor;
let cashier: Actor;

beforeAll(async () => {
  ({ db, close } = await freshDb());
});
afterAll(async () => close());

describe("accounts and login", () => {
  it("creates the first admin only once", async () => {
    const u = await createFirstAdmin(db, { name: "First Admin", email: "Admin@Example.test", password: "correct horse battery" });
    expect(u.email).toBe("admin@example.test");
    expect(u.role).toBe("admin");
    admin = { id: u.id, role: "admin", name: u.name };
    await expect(createFirstAdmin(db, { name: "Second", email: "b@example.test", password: "another long one" })).rejects.toThrow(/already done/);
  });

  it("logs in case-insensitively and rejects wrong passwords", async () => {
    await expect(verifyLogin(db, "ADMIN@example.test", "correct horse battery")).resolves.toMatchObject({ id: admin.id });
    await expect(verifyLogin(db, "admin@example.test", "wrong password")).rejects.toThrow(/don't match/);
    await expect(verifyLogin(db, "nobody@example.test", "whatever")).rejects.toThrow(/don't match/);
  });

  it("locks an account after five wrong passwords", async () => {
    const u = await createUser(db, admin, { name: "Lock Test", email: "lock@example.test", role: "cashier", password: "right password!" });
    for (let i = 0; i < 5; i++) await verifyLogin(db, "lock@example.test", "nope").catch(() => {});
    await expect(verifyLogin(db, "lock@example.test", "right password!")).rejects.toThrow(/Too many/);
    const later = new Date(Date.now() + 6 * 60_000);
    await expect(verifyLogin(db, "lock@example.test", "right password!", later)).resolves.toMatchObject({ id: u.id });
  });

  it("stores only a hash of the session token and expires sessions", async () => {
    const { token } = await createSession(db, admin.id);
    expect(await findSessionUser(db, token)).toMatchObject({ id: admin.id });
    const tomorrow = new Date(Date.now() + 15 * 3600_000);
    expect(await findSessionUser(db, token, tomorrow)).toBeNull();
    await deleteSession(db, token);
    expect(await findSessionUser(db, token)).toBeNull();
  });

  it("only admins can create accounts, and the last admin can't be demoted", async () => {
    const c = await createUser(db, admin, { name: "Cash", email: "cash@example.test", role: "cashier", password: "cashier password" });
    cashier = { id: c.id, role: "cashier", name: c.name };
    await expect(createUser(db, cashier, { name: "X", email: "x@example.test", role: "admin", password: "xxxxxxxxxxxx" })).rejects.toThrow(/permission/);
    await expect(createUser(db, admin, { name: "Dup", email: "CASH@example.test", role: "cashier", password: "xxxxxxxxxxxx" })).rejects.toThrow(/already has/);
    await expect(updateUser(db, admin, admin.id, { role: "cashier" })).rejects.toThrow(/at least one active admin/);
    await expect(updateUser(db, admin, admin.id, { active: false })).rejects.toThrow(/at least one active admin/);
  });

  it("deactivating someone signs them out", async () => {
    const { token } = await createSession(db, cashier.id);
    await updateUser(db, admin, cashier.id, { active: false });
    expect(await findSessionUser(db, token)).toBeNull();
    await updateUser(db, admin, cashier.id, { active: true });
  });

  it("never writes password hashes to the audit log", async () => {
    const rows = await db.select().from(auditLog).where(eq(auditLog.tableName, "users"));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(JSON.stringify(r.after ?? {})).not.toMatch(/passwordHash|\$2[aby]\$/);
  });
});

describe("events, stations and items", () => {
  let eventId: number;

  it("creates an event with no date yet", async () => {
    const ev = await createEvent(db, admin, { name: "Bake Sale 2026", saleDate: "" });
    expect(ev.saleDate).toBeNull();
    expect(ev.status).toBe("draft");
    eventId = ev.id;
    await expect(createEvent(db, cashier, { name: "Nope" })).rejects.toThrow(/permission/);
  });

  it("generates codes from the station letter", async () => {
    const a = await createStation(db, admin, eventId, { name: "Sweets" });
    const b = await createStation(db, admin, eventId, { name: "Savory" });
    expect([a.codePrefix, b.codePrefix]).toEqual(["A", "B"]);
    const i1 = await createItem(db, admin, eventId, { name: "Brownies", price: "3", stationId: a.id });
    const i2 = await createItem(db, admin, eventId, { name: "Cupcakes", price: "$3.00", stationId: a.id });
    const i3 = await createItem(db, admin, eventId, { name: "Puffs", price: "6", stationId: b.id });
    const i4 = await createItem(db, admin, eventId, { name: "Mystery", price: "" });
    expect([i1.code, i2.code, i3.code, i4.code]).toEqual(["A01", "A02", "B01", "U01"]);
    expect(i4.unitPriceCents).toBeNull();
    await expect(createItem(db, admin, eventId, { name: "Dup", code: "a01", price: "1" })).rejects.toThrow(/already has that code/);
    await expect(createItem(db, admin, eventId, { name: "Bad", price: "1.234" })).rejects.toThrow(/Price should look like/);
  });

  it("renumbers codes by station while in draft", async () => {
    const list = await listItems(db, eventId);
    const mystery = list.find((i) => i.name === "Mystery")!;
    const savory = list.find((i) => i.name === "Puffs")!.station!;
    await updateItem(db, admin, mystery.id, { ...mystery, price: "2", stationId: savory.id });
    expect((await listItems(db, eventId)).find((i) => i.name === "Mystery")!.code).toBe("U01");
    await renumberCodes(db, admin, eventId);
    const codes = Object.fromEntries((await listItems(db, eventId)).map((i) => [i.name, i.code]));
    expect(codes).toEqual({ Brownies: "A01", Cupcakes: "A02", Puffs: "B01", Mystery: "B02" });
  });

  it("locks codes and deletion once the sale is open, but prices can still change", async () => {
    await setEventStatus(db, admin, eventId, "open");
    const brownies = (await listItems(db, eventId)).find((i) => i.name === "Brownies")!;
    await expect(updateItem(db, admin, brownies.id, { ...brownies, code: "Z09", price: "3" })).rejects.toThrow(/codes can't change/);
    await expect(deleteItem(db, admin, brownies.id)).rejects.toThrow(/inactive instead/);
    await expect(renumberCodes(db, admin, eventId)).rejects.toThrow(/codes can't change/);
    await expect(deleteStation(db, admin, brownies.stationId!)).rejects.toThrow(/can't be removed/);
    const updated = await updateItem(db, admin, brownies.id, { ...brownies, code: brownies.code, price: "3.50" });
    expect(updated.unitPriceCents).toBe(350);
    expect(updated.code).toBe("A01");
    await expect(setEventStatus(db, admin, eventId, "draft")).rejects.toThrow(/can't be changed/);
  });

  it("makes a closed event read-only", async () => {
    await setEventStatus(db, admin, eventId, "closed");
    await expect(createItem(db, admin, eventId, { name: "Late", price: "1" })).rejects.toThrow(/closed/);
    await expect(updateEvent(db, admin, eventId, { name: "Renamed" })).rejects.toThrow(/closed/);
  });

  it("copies last year's catalog into a new event with the same codes", async () => {
    const next = await createEvent(db, admin, { name: "Bake Sale 2027", saleDate: "2027-03-14" }, eventId);
    const copied = await listItems(db, next.id);
    expect(copied.map((i) => [i.code, i.name, i.station?.name])).toEqual([
      ["A01", "Brownies", "Sweets"],
      ["A02", "Cupcakes", "Sweets"],
      ["B01", "Puffs", "Savory"],
      ["B02", "Mystery", "Savory"],
    ]);
    expect(copied.every((i) => i.availableQty === null && i.sourceItemId !== null)).toBe(true);
    // Last year's records are untouched and separate.
    expect((await listItems(db, eventId)).map((i) => i.id)).not.toContain(copied[0].id);
  });
});

describe("importing the 2025 sheet and volunteer signups", () => {
  let eventId: number;

  it("imports items, prices and signups, and is safe to re-run", async () => {
    const ev = await createEvent(db, admin, { name: "Import Test" });
    eventId = ev.id;
    const station = await createStation(db, admin, eventId, { name: "Main", codePrefix: "M" });
    const preview = buildImportPreview([signupSheet(), financeSheet()]);
    const res = await applyImport(db, admin, eventId, preview, {
      quantity: { kind: "source", source: "Finance · Quantity" },
      stationId: station.id,
      importVolunteers: true,
      skipKeys: ["soda"],
    });
    expect(res.created).toHaveLength(18);
    expect(res.created[0]).toEqual({ code: "M01", name: "Achar (Pickle)" });
    expect(res.signupsCreated).toBe(2);

    const list = await listItems(db, eventId);
    const cupcakes = list.find((i) => i.name === "Cupcakes")!;
    expect(cupcakes.expectedQty).toBe(100);
    expect(cupcakes.unitPriceCents).toBe(300);
    expect(list.find((i) => i.name === "Vattayappam")!.unitPriceCents).toBeNull();
    expect(list.find((i) => i.name === "Vattayappam")!.importNote).toMatch(/blank/);
    const pizza = list.find((i) => i.name === "Pizza (Pies)")!;
    expect(pizza.committedQty).toBe(3);
    expect(pizza.unknownSignupQty).toBe(1);

    const again = await applyImport(db, admin, eventId, preview, { quantity: { kind: "none" }, stationId: null, importVolunteers: true });
    expect(again.created.map((c) => c.name)).toEqual(["Soda"]);
    expect(again.skippedExisting).toHaveLength(18);
    expect(again.created[0].code).toBe("U01");
  });

  it("supports several volunteers per item and large quantities only when ticked", async () => {
    const list = await listItems(db, eventId);
    const puffs = list.find((i) => i.name === "Puffs")!;
    await addSignup(db, admin, puffs.id, { volunteerName: "Anna", qty: "10" });
    await addSignup(db, admin, puffs.id, { volunteerName: "Ben", qty: 5 });
    await addSignup(db, admin, puffs.id, { volunteerName: "  anna ", qty: 2 }); // same Anna, second batch
    await expect(addSignup(db, admin, puffs.id, { volunteerName: "Cara", qty: 150 })).rejects.toThrow(/large quantity/);
    await addSignup(db, admin, puffs.id, { volunteerName: "Cara", qty: 150, allowLarge: true });
    await expect(addSignup(db, admin, puffs.id, { volunteerName: "Dan", qty: 0 })).rejects.toThrow(/1 or more/);
    await expect(addSignup(db, cashier, puffs.id, { volunteerName: "Eve", qty: 1 })).rejects.toThrow(/permission/);

    const after = (await listItems(db, eventId)).find((i) => i.name === "Puffs")!;
    expect(after.committedQty).toBe(167);
    expect(after.signupCount).toBe(4);

    const bring = await bringList(db, eventId);
    const anna = bring.find((b) => b.volunteerName === "Anna")!;
    expect(anna.lines.map((l) => l.qty)).toEqual([10, 2]);
  });

  it("fills in an unknown imported quantity later", async () => {
    const pizza = (await listItems(db, eventId)).find((i) => i.name === "Pizza (Pies)")!;
    const [unknown] = await db.select().from(signups).where(eq(signups.itemId, pizza.id)).then((r) => r.filter((s) => s.committedQty === null));
    await updateSignup(db, admin, unknown.id, { qty: 2 });
    const after = (await listItems(db, eventId)).find((i) => i.name === "Pizza (Pies)")!;
    expect(after.committedQty).toBe(5);
    expect(after.unknownSignupQty).toBe(0);
  });

  it("records an audit row for every change", async () => {
    const rows = await db.select().from(auditLog).where(eq(auditLog.eventId, eventId));
    const actions = rows.map((r) => r.action);
    expect(actions.filter((a) => a === "item.import")).toHaveLength(19);
    expect(actions).toContain("event.import_summary");
    expect(actions).toContain("signup.update");
    expect(rows.every((r) => r.userId === admin.id)).toBe(true);
  });

  it("keeps the database the only source of truth for item rows", async () => {
    const count = await db.select().from(items).where(eq(items.eventId, eventId));
    expect(count).toHaveLength(19);
    const [u] = await db.select().from(users).where(eq(users.id, admin.id));
    expect(u.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });
});
