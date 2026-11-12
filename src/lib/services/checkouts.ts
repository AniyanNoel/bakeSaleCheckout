import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbLike } from "@/db";
import { checkoutLines, checkouts, events, items, members, type Checkout, type CheckoutLine, type PaymentMethod } from "@/db/schema";
import { MAX_LINE_QTY } from "../constants";
import { UserError, isUniqueViolation } from "../errors";
import { assertCan, type Actor } from "../permissions";
import { parseInput } from "../validate";
import { writeAudit } from "./audit";
import { normalizeAccount } from "./members";

export const PAYMENT_METHODS = ["cash", "venmo", "check"] as const;
export const METHOD_LABELS: Record<PaymentMethod, string> = { cash: "Cash", venmo: "Venmo", check: "Check" };

const methodSchema = z.enum(PAYMENT_METHODS).nullish().transform((v) => v ?? null);

const checkoutInput = z.object({
  clientId: z.string().uuid("Bad checkout id."),
  eventId: z.number().int().positive(),
  accountNumber: z.string().max(30, "That account number is too long.").nullish().transform((v) => (v ? normalizeAccount(v) || null : null)),
  name: z.string().trim().max(100).nullish().transform((v) => v || ""),
  lines: z
    .array(
      z.object({
        itemId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(MAX_LINE_QTY),
      }),
    )
    .min(1, "Add at least one item."),
  paymentMethod: methodSchema,
  paid: z.boolean(),
  note: z.string().trim().max(500).nullish().transform((v) => v || null),
  soldAt: z.string().datetime({ offset: true }).optional(),
});

export type CheckoutResult = { checkout: Checkout; duplicate: boolean };

async function byClientId(db: DbLike, clientId: string): Promise<Checkout | null> {
  const [c] = await db.select().from(checkouts).where(eq(checkouts.clientId, clientId));
  return c ?? null;
}

/**
 * Save one checkout. Safe to send twice: the same clientId returns the first
 * one. Prices come from the item list at the moment it is saved, and are copied
 * onto the record so later price changes never alter it.
 *
 * A new account number with a name adds that person to the directory.
 */
export async function submitCheckout(db: DbLike, actor: Actor, input: unknown): Promise<CheckoutResult> {
  assertCan(actor, "checkout");
  const data = parseInput(checkoutInput, input);
  const existing = await byClientId(db, data.clientId);
  if (existing) return { checkout: existing, duplicate: true };
  if (data.paid && !data.paymentMethod) throw new UserError("Pick how they paid: cash, Venmo or check.");

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${data.clientId}))`);
      const again = await byClientId(tx, data.clientId);
      if (again) return { checkout: again, duplicate: true };

      const [ev] = await tx.select().from(events).where(eq(events.id, data.eventId));
      if (!ev) throw new UserError("That event no longer exists.");

      // Who is buying
      let memberId: number | null = null;
      let name = data.name;
      if (data.accountNumber) {
        const [m] = await tx.select().from(members).where(eq(members.accountNumber, data.accountNumber));
        if (m) {
          memberId = m.id;
          name ||= m.name;
        } else {
          if (!name) throw new UserError(`Account ${data.accountNumber} isn't in the list yet. Type their name too.`);
          const [nm] = await tx.insert(members).values({ accountNumber: data.accountNumber, name }).returning();
          memberId = nm.id;
          await writeAudit(tx, actor, { action: "person.create_at_checkout", table: "members", rowId: nm.id, after: nm });
        }
      }
      if (!name) throw new UserError("Type an account number or a name.");

      // What they bought
      const ids = [...new Set(data.lines.map((l) => l.itemId))];
      const found = await tx.select().from(items).where(and(eq(items.eventId, ev.id), inArray(items.id, ids)));
      const byId = new Map(found.map((i) => [i.id, i]));
      const qty = new Map<number, number>();
      for (const l of data.lines) qty.set(l.itemId, (qty.get(l.itemId) ?? 0) + l.quantity);
      const lines = [...qty].map(([itemId, quantity]) => {
        const it = byId.get(itemId);
        if (!it) throw new UserError("One of the items was removed from the list. Take it out and add it again.");
        if (it.unitPriceCents === null) throw new UserError(`${it.code} ${it.name} has no price yet. Set it on the Items page.`);
        if (quantity > MAX_LINE_QTY) throw new UserError(`Too many ${it.name}.`);
        return {
          itemId,
          itemCode: it.code,
          itemName: it.name,
          unitPriceCents: it.unitPriceCents,
          quantity,
          lineTotalCents: it.unitPriceCents * quantity,
        };
      });
      const totalCents = lines.reduce((s, l) => s + l.lineTotalCents, 0);
      const soldAt = data.soldAt ? new Date(data.soldAt) : new Date();

      const [c] = await tx
        .insert(checkouts)
        .values({
          clientId: data.clientId,
          eventId: ev.id,
          memberId,
          accountNumber: data.accountNumber,
          customerName: name,
          totalCents,
          paymentMethod: data.paymentMethod,
          paid: data.paid,
          paidAt: data.paid ? soldAt : null,
          note: data.note,
          createdBy: actor.id,
          soldAt,
        })
        .returning();
      await tx.insert(checkoutLines).values(lines.map((l) => ({ ...l, checkoutId: c.id })));
      await writeAudit(tx, actor, { action: "checkout.create", table: "checkouts", rowId: c.id, eventId: ev.id, after: { ...c, lines } });
      return { checkout: c, duplicate: false };
    });
  } catch (err) {
    if (isUniqueViolation(err, "checkouts_client_key")) {
      const c = await byClientId(db, data.clientId);
      if (c) return { checkout: c, duplicate: true };
    }
    throw err;
  }
}

export type CheckoutRow = Checkout & { lines: CheckoutLine[] };
export type CheckoutFilter = { q?: string; show?: "all" | "unpaid" | "paid" };

export async function listCheckouts(db: DbLike, actor: Actor, eventId: number, filter: CheckoutFilter = {}): Promise<CheckoutRow[]> {
  assertCan(actor, "checkout");
  const conds = [eq(checkouts.eventId, eventId)];
  if (filter.show === "unpaid") conds.push(eq(checkouts.paid, false));
  if (filter.show === "paid") conds.push(eq(checkouts.paid, true));
  const term = filter.q?.trim().replace(/[%_]/g, "");
  if (term) conds.push(or(ilike(checkouts.customerName, `%${term}%`), eq(checkouts.accountNumber, normalizeAccount(term)))!);
  const rows = await db.select().from(checkouts).where(and(...conds)).orderBy(desc(checkouts.soldAt), desc(checkouts.id));
  if (!rows.length) return [];
  const lines = await db
    .select()
    .from(checkoutLines)
    .where(inArray(checkoutLines.checkoutId, rows.map((r) => r.id)))
    .orderBy(checkoutLines.id);
  const byCheckout = new Map<number, CheckoutLine[]>();
  for (const l of lines) {
    if (!byCheckout.has(l.checkoutId)) byCheckout.set(l.checkoutId, []);
    byCheckout.get(l.checkoutId)!.push(l);
  }
  return rows.map((r) => ({ ...r, lines: byCheckout.get(r.id) ?? [] }));
}

export type EventTotals = {
  count: number;
  totalCents: number;
  paidCents: number;
  unpaidCents: number;
  unpaidCount: number;
  byMethod: Record<PaymentMethod, number>;
};

/** Money for the whole event, regardless of any search on the page. */
export async function eventTotals(db: DbLike, actor: Actor, eventId: number): Promise<EventTotals> {
  assertCan(actor, "checkout");
  const rows = await db
    .select({ total: checkouts.totalCents, paid: checkouts.paid, method: checkouts.paymentMethod })
    .from(checkouts)
    .where(eq(checkouts.eventId, eventId));
  const t: EventTotals = { count: rows.length, totalCents: 0, paidCents: 0, unpaidCents: 0, unpaidCount: 0, byMethod: { cash: 0, venmo: 0, check: 0 } };
  for (const r of rows) {
    t.totalCents += r.total;
    if (r.paid) {
      t.paidCents += r.total;
      if (r.method) t.byMethod[r.method] += r.total;
    } else {
      t.unpaidCents += r.total;
      t.unpaidCount++;
    }
  }
  return t;
}

const updateInput = z.object({
  paid: z.boolean(),
  paymentMethod: methodSchema,
  note: z.string().trim().max(500).nullish().transform((v) => v || null),
});

/** Mark paid or not paid, change how they paid, or add a note. */
export async function updateCheckout(db: DbLike, actor: Actor, id: number, input: unknown): Promise<Checkout> {
  assertCan(actor, "checkout");
  const data = parseInput(updateInput, input);
  if (data.paid && !data.paymentMethod) throw new UserError("Pick how they paid: cash, Venmo or check.");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(checkouts).where(eq(checkouts.id, id)).for("update");
    if (!before) throw new UserError("That checkout no longer exists.");
    const paidAt = data.paid ? (before.paid ? before.paidAt : new Date()) : null;
    const [after] = await tx.update(checkouts).set({ ...data, paidAt }).where(eq(checkouts.id, id)).returning();
    await writeAudit(tx, actor, { action: "checkout.update", table: "checkouts", rowId: id, eventId: before.eventId, before, after });
    return after;
  });
}

/** Remove a checkout rung up by mistake. The audit log keeps a copy. */
export async function deleteCheckout(db: DbLike, actor: Actor, id: number): Promise<void> {
  assertCan(actor, "checkout");
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(checkouts).where(eq(checkouts.id, id)).for("update");
    if (!before) return;
    const lines = await tx.select().from(checkoutLines).where(eq(checkoutLines.checkoutId, id));
    await tx.delete(checkouts).where(eq(checkouts.id, id));
    await writeAudit(tx, actor, { action: "checkout.delete", table: "checkouts", rowId: id, eventId: before.eventId, before: { ...before, lines } });
  });
}

/** "A01, A02 x2, B03" */
export function itemsSummary(lines: Pick<CheckoutLine, "itemCode" | "quantity">[]): string {
  return lines.map((l) => (l.quantity > 1 ? `${l.itemCode} x${l.quantity}` : l.itemCode)).join(", ");
}
