import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { checkoutLines, members } from "@/db/schema";
import { parseDirectory } from "@/lib/import/directory";
import type { Actor } from "@/lib/permissions";
import { deleteCheckout, eventTotals, itemsSummary, listCheckouts, submitCheckout, updateCheckout } from "@/lib/services/checkouts";
import { createEvent } from "@/lib/services/events";
import { createItem, updateItem } from "@/lib/services/items";
import { createPerson, importDirectory, listPeople } from "@/lib/services/members";
import { createStation } from "@/lib/services/stations";
import { freshDb, makeActor } from "./db-helpers";

let db: Db;
let close: () => Promise<void>;
let me: Actor;
let eventId: number;
const item: Record<string, number> = {};

beforeAll(async () => {
  ({ db, close } = await freshDb());
  me = await makeActor(db, "admin");
  eventId = (await createEvent(db, me, { name: "Bake Sale 2027" })).id;
  const indian = await createStation(db, me, eventId, { name: "Indian food", codePrefix: "A" });
  const sweets = await createStation(db, me, eventId, { name: "Sweets", codePrefix: "B" });
  item.kappa = (await createItem(db, me, eventId, { name: "Kappa and fish", price: "10", stationId: indian.id })).id; // A01
  item.poori = (await createItem(db, me, eventId, { name: "Poori and chicken", price: "8", stationId: indian.id })).id; // A02
  item.cake = (await createItem(db, me, eventId, { name: "Pound cake", price: "4.50", stationId: sweets.id })).id; // B01
  item.tbd = (await createItem(db, me, eventId, { name: "Vattayappam", stationId: sweets.id })).id; // B02, no price
  await createPerson(db, me, { accountNumber: "9", name: "Noel" });
});
afterAll(() => close());

const sale = (over: Record<string, unknown> = {}) => ({
  clientId: randomUUID(),
  eventId,
  accountNumber: "9",
  lines: [
    { itemId: item.kappa, quantity: 1 },
    { itemId: item.poori, quantity: 2 },
  ],
  paymentMethod: "venmo",
  paid: true,
  ...over,
});

describe("checkout", () => {
  it("fills in the name from the account number and adds up the total", async () => {
    const { checkout: c } = await submitCheckout(db, me, sale());
    expect([c.customerName, c.accountNumber, c.totalCents, c.paymentMethod, c.paid]).toEqual(["Noel", "9", 2600, "venmo", true]);
    const lines = await db.select().from(checkoutLines).where(eq(checkoutLines.checkoutId, c.id));
    expect(itemsSummary(lines)).toBe("A01, A02 x2");
  });

  it("adds a new account number to the people list when a name is given", async () => {
    await expect(submitCheckout(db, me, sale({ accountNumber: "42" }))).rejects.toThrow(/Type their name/);
    const { checkout: c } = await submitCheckout(db, me, sale({ accountNumber: " 42 ", name: "Mary", paid: false, paymentMethod: null }));
    expect([c.customerName, c.accountNumber, c.paid]).toEqual(["Mary", "42", false]);
    expect((await listPeople(db, me, "42")).map((p) => p.name)).toEqual(["Mary"]);
  });

  it("allows a name with no account number", async () => {
    const { checkout: c } = await submitCheckout(db, me, sale({ accountNumber: null, name: "Visitor", paymentMethod: "cash", lines: [{ itemId: item.cake, quantity: 1 }] }));
    expect([c.customerName, c.accountNumber, c.totalCents]).toEqual(["Visitor", null, 450]);
  });

  it("refuses what can't be right", async () => {
    await expect(submitCheckout(db, me, sale({ lines: [] }))).rejects.toThrow(/at least one item/);
    await expect(submitCheckout(db, me, sale({ paymentMethod: null }))).rejects.toThrow(/how they paid/);
    await expect(submitCheckout(db, me, sale({ lines: [{ itemId: item.tbd, quantity: 1 }] }))).rejects.toThrow(/no price yet/);
    await expect(submitCheckout(db, me, sale({ accountNumber: null, name: "" }))).rejects.toThrow(/account number or a name/);
  });

  it("saves only once when the same checkout is sent twice at the same moment", async () => {
    const s = sale();
    const [a, b] = await Promise.all([submitCheckout(db, me, s), submitCheckout(db, me, s)]);
    expect(a.checkout.id).toBe(b.checkout.id);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
  });

  it("keeps the price it was sold at when the price changes later", async () => {
    const { checkout: c } = await submitCheckout(db, me, sale({ lines: [{ itemId: item.cake, quantity: 2 }] }));
    await updateItem(db, me, item.cake, { name: "Pound cake", price: "6", stationId: null, code: "B01" });
    const [row] = (await listCheckouts(db, me, eventId)).filter((r) => r.id === c.id);
    expect([row.totalCents, row.lines[0].unitPriceCents]).toEqual([900, 450]);
  });

  it("marks a checkout paid later and keeps the totals right", async () => {
    const unpaid = (await listCheckouts(db, me, eventId, { show: "unpaid" }))[0];
    expect(unpaid.customerName).toBe("Mary");
    let t = await eventTotals(db, me, eventId);
    expect(t.unpaidCents).toBe(2600);
    await expect(updateCheckout(db, me, unpaid.id, { paid: true, paymentMethod: null })).rejects.toThrow(/how they paid/);
    const after = await updateCheckout(db, me, unpaid.id, { paid: true, paymentMethod: "cash" });
    expect(after.paidAt).not.toBeNull();
    t = await eventTotals(db, me, eventId);
    expect(t.unpaidCents).toBe(0);
    expect(t.paidCents).toBe(t.totalCents);
    expect(t.byMethod.cash).toBe(2600 + 450);
  });

  it("searches by name or account number", async () => {
    expect((await listCheckouts(db, me, eventId, { q: "mar" })).map((r) => r.customerName)).toEqual(["Mary"]);
    expect((await listCheckouts(db, me, eventId, { q: "9" })).every((r) => r.accountNumber === "9")).toBe(true);
  });

  it("deletes a checkout rung up by mistake", async () => {
    const before = await eventTotals(db, me, eventId);
    const { checkout: c } = await submitCheckout(db, me, sale());
    await deleteCheckout(db, me, c.id);
    expect(await eventTotals(db, me, eventId)).toEqual(before);
  });
});

describe("church directory", () => {
  it("reads Account and Name columns, or First and Last name", () => {
    expect(parseDirectory([{ name: "Sheet1", rows: [["Directory"], ["Account #", "Name"], [9, "Noel"], ["", ""], ["12", " Ann Thomas "]] }]).rows).toEqual([
      { accountNumber: "9", name: "Noel" },
      { accountNumber: "12", name: "Ann Thomas" },
    ]);
    expect(parseDirectory([{ name: "x", rows: [["ID", "First Name", "Last Name"], [3, "Sam", "George"]] }]).rows).toEqual([{ accountNumber: "3", name: "Sam George" }]);
    expect(() => parseDirectory([{ name: "x", rows: [["Foo", "Bar"]] }])).toThrow(/Account/);
  });

  it("adds new people, renames changed ones and is safe to load twice", async () => {
    const rows = [
      { accountNumber: "9", name: "Noel A." },
      { accountNumber: "100", name: "New Person" },
      { accountNumber: "", name: "No number" },
    ];
    const r = await importDirectory(db, me, rows);
    expect([r.added, r.updated, r.skipped.length]).toEqual([1, 1, 1]);
    const again = await importDirectory(db, me, rows);
    expect([again.added, again.updated, again.unchanged]).toEqual([0, 0, 2]);
    const [noel] = await db.select().from(members).where(eq(members.accountNumber, "9"));
    expect(noel.name).toBe("Noel A.");
  });
});
