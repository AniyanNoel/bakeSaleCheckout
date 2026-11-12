import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { payments, transactions } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { computeSale } from "@/lib/sale-math";
import { createEvent, setEventStatus } from "@/lib/services/events";
import { createItem, updateItem } from "@/lib/services/items";
import { createMember, findMemberByAccount } from "@/lib/services/members";
import {
  getTransactionDetail,
  listOutstanding,
  listPendingPayments,
  memberSales,
  refundTransaction,
  setPaymentStatus,
  settleMemberBalance,
  submitSale,
  voidTransaction,
  writeOff,
} from "@/lib/services/sales";
import { freshDb, makeActor } from "./db-helpers";

describe("sale arithmetic", () => {
  const lines = [{ unitPriceCents: 300, quantity: 2 }, { unitPriceCents: 550, quantity: 1 }]; // $11.50

  it("gives change from cash only", () => {
    const r = computeSale(lines, [{ method: "cash", amountCents: 2000 }], "change");
    expect(r).toMatchObject({ totalCents: 1150, changeCents: 850, balanceCents: 0, donationCents: 0 });
    expect(r.applied).toEqual([{ method: "cash", amountCents: 1150 }]);
  });
  it("keeps an overpayment as a donation when asked", () => {
    const r = computeSale(lines, [{ method: "venmo", amountCents: 1500 }], "donation");
    expect(r).toMatchObject({ donationCents: 350, changeCents: 0, balanceCents: 0 });
  });
  it("refuses change out of Venmo", () => {
    expect(computeSale(lines, [{ method: "venmo", amountCents: 1500 }], "change").problem).toMatch(/donation/);
  });
  it("splits and leaves the rest owed", () => {
    const r = computeSale([{ unitPriceCents: 3000, quantity: 1 }], [{ method: "cash", amountCents: 1000 }, { method: "venmo", amountCents: 1500 }], "change");
    expect(r.balanceCents).toBe(500);
  });
  it("takes change from cash even when Venmo is listed after it", () => {
    const r = computeSale([{ unitPriceCents: 1000, quantity: 1 }], [{ method: "cash", amountCents: 1000 }, { method: "venmo", amountCents: 500 }], "change");
    expect(r.applied).toEqual([{ method: "cash", amountCents: 500 }, { method: "venmo", amountCents: 500 }]);
    expect(r.changeCents).toBe(500);
  });
});

let db: Db;
let close: () => Promise<void>;
let admin: Actor;
let cashier: Actor;
let cashier2: Actor;
let eventId: number;
let brownies: { id: number; price: number };
let pizza: { id: number; price: number };

beforeAll(async () => {
  ({ db, close } = await freshDb());
  admin = await makeActor(db, "admin");
  cashier = await makeActor(db, "cashier");
  cashier2 = await makeActor(db, "cashier", "cashier2@example.test");
  const ev = await createEvent(db, admin, { name: "Sale" });
  eventId = ev.id;
  const b = await createItem(db, admin, eventId, { name: "Brownies", price: "3", availableQty: "5" });
  const p = await createItem(db, admin, eventId, { name: "Pizza slice", price: "3" });
  brownies = { id: b.id, price: 300 };
  pizza = { id: p.id, price: 300 };
});
afterAll(async () => close());

function sale(over: Record<string, unknown> = {}) {
  return {
    clientId: randomUUID(),
    eventId,
    customer: { kind: "walk_up" },
    lines: [{ itemId: brownies.id, quantity: 2, unitPriceCents: brownies.price }],
    payments: [{ method: "cash", amountCents: 600 }],
    ...over,
  };
}

describe("checkout", () => {
  it("only sells while the event is open", async () => {
    await expect(submitSale(db, cashier, sale())).rejects.toThrow(/isn't open/);
    await setEventStatus(db, admin, eventId, "open");
  });

  it("records a paid sale and gives change", async () => {
    const r = await submitSale(db, cashier, sale({ payments: [{ method: "cash", amountCents: 1000 }] }));
    expect(r.duplicate).toBe(false);
    expect(r.changeCents).toBe(400);
    expect(r.transaction.totalCents).toBe(600);
    const d = (await getTransactionDetail(db, r.transaction.id))!;
    expect(d.payments.map((p) => [p.method, p.amountCents, p.status])).toEqual([["cash", 600, "received"]]);
    expect(d.balanceCents).toBe(0);
    expect(d.lines[0]).toMatchObject({ itemCode: "U01", itemName: "Brownies", unitPriceCents: 300, quantity: 2 });
  });

  it("never records the same sale twice, even if sent again", async () => {
    const s = sale();
    const first = await submitSale(db, cashier, s);
    const [again, third] = await Promise.all([submitSale(db, cashier, s), submitSale(db, cashier, s)]);
    expect(again.duplicate).toBe(true);
    expect(third.duplicate).toBe(true);
    expect(again.transaction.id).toBe(first.transaction.id);
    const rows = await db.select().from(transactions).where(eq(transactions.clientId, s.clientId));
    expect(rows).toHaveLength(1);
    const pays = await db.select().from(payments).where(eq(payments.transactionId, first.transaction.id));
    expect(pays).toHaveLength(1);
  });

  it("does not trust Venmo or checks as received money", async () => {
    await expect(submitSale(db, cashier, sale({ payments: [{ method: "check", amountCents: 600 }] }))).rejects.toThrow(/check number/);
    const r = await submitSale(db, cashier, sale({ payments: [{ method: "venmo", amountCents: 200, reference: "@anna" }, { method: "check", amountCents: 400, reference: "1234" }] }));
    const d = (await getTransactionDetail(db, r.transaction.id))!;
    expect(d.payments.every((p) => p.status === "pending")).toBe(true);
    expect(d.pendingCents).toBe(600);
    expect(d.balanceCents).toBe(0);
  });

  it("requires a member account to leave a balance", async () => {
    await expect(submitSale(db, cashier, sale({ payments: [{ method: "cash", amountCents: 100 }] }))).rejects.toThrow(/account number/);
    const r = await submitSale(
      db,
      cashier,
      sale({ customer: { kind: "new_member", accountNumber: " smc-101 ", name: "Mary Example" }, payments: [{ method: "cash", amountCents: 100 }] }),
    );
    expect(r.balanceCents).toBe(500);
    expect(r.transaction.flags.join(" ")).toMatch(/New member/);
    const m = await findMemberByAccount(db, "SMC-101");
    expect(m).toMatchObject({ name: "Mary Example", provisional: true });
    // Pure IOU, no payment at all.
    const r2 = await submitSale(db, cashier, sale({ customer: { kind: "member", memberId: m!.id }, lines: [{ itemId: pizza.id, quantity: 3, unitPriceCents: 300 }], payments: [] }));
    expect(r2.balanceCents).toBe(900);
  });

  it("keeps the price the cashier saw, and flags it if it changed", async () => {
    await updateItem(db, admin, pizza.id, { name: "Pizza slice", price: "3.50" });
    const r = await submitSale(db, cashier, sale({ lines: [{ itemId: pizza.id, quantity: 1, unitPriceCents: 300 }], payments: [{ method: "cash", amountCents: 300 }] }));
    expect(r.transaction.totalCents).toBe(300);
    expect(r.transaction.flags.join(" ")).toMatch(/current price/);
    // Later price edits never change history.
    await updateItem(db, admin, pizza.id, { name: "Pizza (renamed)", price: "4" });
    const d = (await getTransactionDetail(db, r.transaction.id))!;
    expect(d.lines[0]).toMatchObject({ itemName: "Pizza slice", unitPriceCents: 300 });
    pizza.price = 400;
  });

  it("flags oversold items instead of refusing the sale", async () => {
    const r = await submitSale(db, cashier, sale({ lines: [{ itemId: brownies.id, quantity: 3, unitPriceCents: 300 }], payments: [{ method: "cash", amountCents: 900 }] }));
    expect(r.transaction.flags.join(" ")).toMatch(/oversold/);
  });

  it("keeps a donation separate from sales", async () => {
    const r = await submitSale(db, cashier, sale({ payments: [{ method: "venmo", amountCents: 1000, reference: "@x" }], overpay: "donation" }));
    expect(r.transaction).toMatchObject({ totalCents: 600, donationCents: 400 });
  });

  it("only admins can ring up an item that isn't in the catalog", async () => {
    const misc = { lines: [{ misc: true, name: "Samosa", quantity: 1, unitPriceCents: 200, note: "Late donation" }], payments: [{ method: "cash", amountCents: 200 }] };
    await expect(submitSale(db, cashier, sale(misc))).rejects.toThrow(/admin/);
    const r = await submitSale(db, admin, sale(misc));
    expect(r.transaction.flags.join(" ")).toMatch(/Samosa/);
  });
});

describe("voids, refunds and write-offs", () => {
  it("lets a cashier void their own recent sale, reversing the money", async () => {
    const r = await submitSale(db, cashier, sale({ payments: [{ method: "cash", amountCents: 600 }] }));
    await expect(voidTransaction(db, cashier2, r.transaction.id, "wrong items")).rejects.toThrow(/admin/);
    const later = new Date(Date.now() + 20 * 60_000);
    await expect(voidTransaction(db, cashier, r.transaction.id, "wrong items", later)).rejects.toThrow(/15 minutes/);
    await voidTransaction(db, cashier, r.transaction.id, "wrong items");
    const d = (await getTransactionDetail(db, r.transaction.id))!;
    expect(d.status).toBe("voided");
    expect(d.payments.map((p) => p.amountCents)).toEqual([600, -600]);
    expect(d).toMatchObject({ owedCents: 0, receivedCents: 0, balanceCents: 0 });
    await expect(voidTransaction(db, admin, r.transaction.id, "again")).rejects.toThrow(/already voided/);
  });

  it("refunds part of a sale and records the money handed back", async () => {
    const r = await submitSale(db, cashier, sale({ payments: [{ method: "cash", amountCents: 600 }] }));
    await expect(refundTransaction(db, cashier, r.transaction.id, { amountCents: 300, reason: "spoiled", returnMethod: "cash" })).rejects.toThrow(/permission/);
    await refundTransaction(db, admin, r.transaction.id, { amountCents: 300, reason: "one was spoiled", returnMethod: "cash" });
    const d = (await getTransactionDetail(db, r.transaction.id))!;
    expect(d).toMatchObject({ owedCents: 300, receivedCents: 300, balanceCents: 0 });
    await expect(refundTransaction(db, admin, r.transaction.id, { amountCents: 500, reason: "too much", returnMethod: "cash" })).rejects.toThrow(/most/);
  });

  it("writes off an IOU with a reason", async () => {
    const m = (await findMemberByAccount(db, "SMC-101"))!;
    const sales = await memberSales(db, m.id);
    const open = sales.find((s) => s.balanceCents === 500)!;
    await expect(writeOff(db, admin, open.id, { amountCents: 600, reason: "x" })).rejects.toThrow(/reason|outstanding/);
    await writeOff(db, admin, open.id, { amountCents: 100, reason: "Rounded off as a courtesy" });
    expect((await getTransactionDetail(db, open.id))!.balanceCents).toBe(400);
  });
});

describe("IOUs and confirming payments", () => {
  let memberId: number;

  it("lists who owes money, keeping owed, received and pending apart", async () => {
    const m = (await findMemberByAccount(db, "SMC-101"))!;
    memberId = m.id;
    const out = await listOutstanding(db, admin);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ accountNumber: "SMC-101", balanceCents: 400 + 900 });
    await expect(listOutstanding(db, cashier)).rejects.toThrow(/permission/);
  });

  it("applies a later payment to the oldest sale first, across sales", async () => {
    await expect(settleMemberBalance(db, admin, memberId, { method: "cash", amountCents: 5000 })).rejects.toThrow(/more than/);
    const r = await settleMemberBalance(db, admin, memberId, { method: "check", amountCents: 600, reference: "2001" });
    expect(r.applied.map((a) => a.amountCents)).toEqual([400, 200]);
    const out = await listOutstanding(db, admin);
    expect(out[0]).toMatchObject({ balanceCents: 700, pendingCents: 600 });
  });

  it("reopens the balance when a check bounces, and closes it when paid", async () => {
    const pending = await listPendingPayments(db, admin);
    const checks = pending.filter((p) => p.p.reference === "2001");
    expect(checks).toHaveLength(2);
    for (const c of checks) await setPaymentStatus(db, admin, c.p.id, "bounced");
    expect((await listOutstanding(db, admin))[0].balanceCents).toBe(1300);
    await settleMemberBalance(db, admin, memberId, { method: "cash", amountCents: 1300 });
    expect(await listOutstanding(db, admin)).toHaveLength(0);
  });

  it("confirms Venmo as cleared; cash can't be cleared or bounced", async () => {
    const [venmo] = (await listPendingPayments(db, admin)).filter((p) => p.p.method === "venmo");
    await setPaymentStatus(db, admin, venmo.p.id, "cleared");
    await expect(setPaymentStatus(db, admin, venmo.p.id, "bounced")).rejects.toThrow(/Only checks/);
    const [cashPay] = await db.select().from(payments).where(eq(payments.method, "cash")).limit(1);
    await expect(setPaymentStatus(db, admin, cashPay.id, "cleared")).rejects.toThrow(/Cash/);
    await expect(setPaymentStatus(db, cashier, venmo.p.id, "cleared")).rejects.toThrow(/permission/);
  });

  it("requires consent before saving contact details", async () => {
    await expect(createMember(db, admin, { accountNumber: "9", name: "Joe", phone: "555", contactConsent: false })).rejects.toThrow(/agreed/);
    const m = await createMember(db, admin, { accountNumber: "9", name: "Joe", phone: "555", contactConsent: true, contactConsentNote: "Said yes in person" });
    expect(m.provisional).toBe(false);
  });
});
