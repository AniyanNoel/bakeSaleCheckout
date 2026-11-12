import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbLike } from "@/db";
import {
  adjustments,
  events,
  items,
  members,
  payments,
  stations,
  transactionLines,
  transactions,
  users,
  type Adjustment,
  type Payment,
  type PaymentMethod,
  type Transaction,
  type TransactionLine,
} from "@/db/schema";
import { DUPLICATE_WINDOW_MINUTES, MAX_LINE_QTY, VOID_WINDOW_MINUTES } from "../constants";
import { ForbiddenError, UserError } from "../errors";
import { can, assertCan, type Actor } from "../permissions";
import { computeSale, saleBalance } from "../sale-math";
import { parseInput } from "../validate";
import { writeAudit } from "./audit";
import { findOrCreateMemberAtCheckout } from "./members";

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

const cents = z.number().int().min(0).max(10_000_000);

const saleInput = z.object({
  clientId: z.string().uuid("This sale is missing its id. Refresh the page and try again."),
  eventId: z.number().int().positive(),
  customer: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("member"), memberId: z.number().int().positive() }),
    z.object({ kind: z.literal("new_member"), accountNumber: z.string(), name: z.string() }),
    z.object({ kind: z.literal("walk_up"), name: z.string().trim().max(100).optional() }),
  ]),
  lines: z
    .array(
      z.union([
        z.object({
          itemId: z.number().int().positive(),
          quantity: z.number().int().min(1).max(MAX_LINE_QTY),
          // The price the cashier saw. Sales rung up offline keep it even if it changed since.
          unitPriceCents: cents,
        }),
        z.object({
          misc: z.literal(true),
          name: z.string().trim().min(1).max(100),
          quantity: z.number().int().min(1).max(MAX_LINE_QTY),
          unitPriceCents: cents,
          note: z.string().trim().min(1, "Say why this item isn't in the catalog.").max(300),
        }),
      ]),
    )
    .min(1, "The cart is empty.")
    .max(100),
  payments: z
    .array(
      z.object({
        method: z.enum(["cash", "venmo", "check"]),
        amountCents: z.number().int().min(1).max(10_000_000),
        reference: z.string().trim().max(100).nullish(),
      }),
    )
    .max(10),
  overpay: z.enum(["change", "donation"]).default("change"),
  soldAt: z.coerce.date().optional(),
  deviceId: z.string().max(100).nullish(),
});
export type SaleInput = z.input<typeof saleInput>;

export type SaleResult = { transaction: Transaction; duplicate: boolean; balanceCents: number; changeCents: number };

export async function getTransactionByClientId(db: DbLike, clientId: string): Promise<Transaction | null> {
  const [t] = await db.select().from(transactions).where(eq(transactions.clientId, clientId));
  return t ?? null;
}

/**
 * Record a completed sale. Safe to call again with the same clientId (after a
 * lost reply or a Wi-Fi drop): the original sale is returned and nothing is added.
 */
export async function submitSale(db: DbLike, actor: Actor, input: unknown, now = new Date()): Promise<SaleResult> {
  assertCan(actor, "checkout");
  const data = parseInput(saleInput, input);

  const already = await getTransactionByClientId(db, data.clientId);
  if (already) return { transaction: already, duplicate: true, ...(await summary(db, already.id)), changeCents: 0 };

  if (data.lines.some((l) => "misc" in l) && !can(actor.role, "miscLine")) {
    throw new ForbiddenError("Only an admin can add an item that isn't in the catalog.");
  }
  for (const p of data.payments) {
    if (p.method === "check" && !p.reference) throw new UserError("Enter the check number.");
  }

  const totals = computeSale(data.lines, data.payments, data.overpay);
  if (totals.problem) throw new UserError(totals.problem);
  if (totals.balanceCents > 0 && data.customer.kind === "walk_up") {
    throw new UserError("Walk-up customers have to pay in full. To leave a balance, enter their account number.");
  }

  try {
    return await db.transaction(async (tx) => {
      // Serialise sales for the same client id across devices and retries.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${data.clientId}))`);
      const again = await getTransactionByClientId(tx, data.clientId);
      if (again) return { transaction: again, duplicate: true, ...(await summary(tx, again.id)), changeCents: 0 };

      const [ev] = await tx.select().from(events).where(eq(events.id, data.eventId));
      if (!ev) throw new UserError("That event no longer exists.");
      if (ev.status !== "open") throw new UserError(`${ev.name} isn't open for sales. An admin opens the sale on the event page.`);

      const flags: string[] = [];
      let memberId: number | null = null;
      let customerName: string;
      if (data.customer.kind === "member") {
        const [m] = await tx.select().from(members).where(eq(members.id, data.customer.memberId));
        if (!m) throw new UserError("That member wasn't found.");
        memberId = m.id;
        customerName = m.name;
      } else if (data.customer.kind === "new_member") {
        const r = await findOrCreateMemberAtCheckout(tx, actor, data.customer);
        memberId = r.member.id;
        customerName = r.member.name;
        if (r.created) flags.push("New member added at checkout; an admin should confirm them.");
        if (r.nameDiffers) flags.push(`Name typed as "${data.customer.name.trim()}" but account ${r.member.accountNumber} is ${r.member.name}.`);
      } else {
        customerName = data.customer.name?.trim() || "Walk-up";
      }

      // Look up the catalog items and snapshot their code, name and station.
      const itemIds = data.lines.flatMap((l) => ("itemId" in l ? [l.itemId] : []));
      const catalog = itemIds.length
        ? await tx
            .select({ item: items, stationName: stations.name })
            .from(items)
            .leftJoin(stations, eq(stations.id, items.stationId))
            .where(and(inArray(items.id, itemIds), eq(items.eventId, ev.id)))
        : [];
      const byId = new Map(catalog.map((c) => [c.item.id, c]));

      const lineRows = data.lines.map((l) => {
        if ("misc" in l) {
          flags.push(`Item not in the catalog: ${l.name} (${l.note}).`);
          return { itemId: null, itemCode: "MISC", itemName: l.name, stationName: null, unitPriceCents: l.unitPriceCents, quantity: l.quantity, lineTotalCents: l.unitPriceCents * l.quantity, note: l.note };
        }
        const c = byId.get(l.itemId);
        if (!c) throw new UserError("One of the items isn't part of this event. Refresh the checkout page.");
        if (!c.item.active) flags.push(`${c.item.code} ${c.item.name} was inactive when sold.`);
        if (c.item.unitPriceCents !== l.unitPriceCents) {
          flags.push(`${c.item.code} sold at ${l.unitPriceCents / 100} but the current price is ${c.item.unitPriceCents === null ? "not set" : c.item.unitPriceCents / 100}.`);
        }
        return {
          itemId: c.item.id,
          itemCode: c.item.code,
          itemName: c.item.name,
          stationName: c.stationName,
          unitPriceCents: l.unitPriceCents,
          quantity: l.quantity,
          lineTotalCents: l.unitPriceCents * l.quantity,
          note: null,
        };
      });

      // Possible double ring-up: same customer, same total, a few minutes apart.
      const since = new Date(now.getTime() - DUPLICATE_WINDOW_MINUTES * 60_000);
      const [dup] = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.eventId, ev.id),
            eq(transactions.status, "completed"),
            eq(transactions.totalCents, totals.totalCents),
            memberId ? eq(transactions.memberId, memberId) : eq(transactions.customerName, customerName),
            gte(transactions.createdAt, since),
          ),
        )
        .limit(1);
      if (dup && (memberId || customerName !== "Walk-up")) flags.push(`Possible duplicate of sale #${dup.id}.`);

      const [t] = await tx
        .insert(transactions)
        .values({
          clientId: data.clientId,
          eventId: ev.id,
          memberId,
          customerName,
          totalCents: totals.totalCents,
          donationCents: totals.donationCents,
          flags,
          createdBy: actor.id,
          deviceId: data.deviceId ?? null,
          soldAt: data.soldAt && data.soldAt < now ? data.soldAt : now,
        })
        .returning();
      await tx.insert(transactionLines).values(lineRows.map((l) => ({ ...l, transactionId: t.id })));

      if (totals.applied.length) {
        const refs = new Map(data.payments.map((p) => [p.method, p.reference ?? null]));
        await tx.insert(payments).values(
          totals.applied.map((p) => ({
            transactionId: t.id,
            memberId,
            method: p.method,
            amountCents: p.amountCents,
            reference: refs.get(p.method) ?? null,
            // Choosing Venmo or check only records a promise; an admin confirms it later.
            status: (p.method === "cash" ? "received" : "pending") as Payment["status"],
            receivedBy: actor.id,
          })),
        );
      }

      // Oversold check (after this sale's lines exist).
      const soldIds = lineRows.flatMap((l) => (l.itemId ? [l.itemId] : []));
      if (soldIds.length) {
        const sold = await tx
          .select({ itemId: transactionLines.itemId, qty: sql<number>`sum(${transactionLines.quantity})::int` })
          .from(transactionLines)
          .innerJoin(transactions, eq(transactions.id, transactionLines.transactionId))
          .where(and(inArray(transactionLines.itemId, soldIds), eq(transactions.status, "completed")))
          .groupBy(transactionLines.itemId);
        for (const s of sold) {
          const c = byId.get(s.itemId!);
          if (c?.item.availableQty != null && s.qty > c.item.availableQty) {
            flags.push(`${c.item.code} oversold: ${s.qty} sold, ${c.item.availableQty} available.`);
          }
        }
        if (flags.length !== t.flags.length) await tx.update(transactions).set({ flags }).where(eq(transactions.id, t.id));
      }

      const saved = { ...t, flags };
      await writeAudit(tx, actor, {
        action: "sale.complete",
        table: "transactions",
        rowId: t.id,
        eventId: ev.id,
        after: { ...saved, lines: lineRows, payments: totals.applied, changeCents: totals.changeCents },
      });
      return { transaction: saved, duplicate: false, balanceCents: totals.balanceCents, changeCents: totals.changeCents };
    });
  } catch (err) {
    // Two requests with the same id raced past the first check.
    const existing = await getTransactionByClientId(db, data.clientId);
    if (existing) return { transaction: existing, duplicate: true, ...(await summary(db, existing.id)), changeCents: 0 };
    throw err;
  }
}

async function summary(db: DbLike, transactionId: number): Promise<{ balanceCents: number }> {
  const d = await getTransactionDetail(db, transactionId);
  return { balanceCents: d?.balanceCents ?? 0 };
}

// ---------------------------------------------------------------------------
// Reading sales and balances
// ---------------------------------------------------------------------------

export type TransactionDetail = Transaction & {
  lines: TransactionLine[];
  payments: (Payment & { receivedByName: string })[];
  adjustments: (Adjustment & { createdByName: string })[];
  createdByName: string;
  memberAccount: string | null;
  owedCents: number;
  receivedCents: number;
  balanceCents: number;
  pendingCents: number;
};

/** Sum of payments that count as received (bounced ones don't). */
const countsAsReceived = (p: Pick<Payment, "status">) => p.status !== "bounced";

export async function getTransactionDetail(db: DbLike, id: number): Promise<TransactionDetail | null> {
  const [row] = await db
    .select({ t: transactions, createdByName: users.name, memberAccount: members.accountNumber })
    .from(transactions)
    .innerJoin(users, eq(users.id, transactions.createdBy))
    .leftJoin(members, eq(members.id, transactions.memberId))
    .where(eq(transactions.id, id));
  if (!row) return null;
  const [lines, pays, adjs] = await Promise.all([
    db.select().from(transactionLines).where(eq(transactionLines.transactionId, id)).orderBy(asc(transactionLines.id)),
    db
      .select({ p: payments, name: users.name })
      .from(payments)
      .innerJoin(users, eq(users.id, payments.receivedBy))
      .where(eq(payments.transactionId, id))
      .orderBy(asc(payments.id)),
    db
      .select({ a: adjustments, name: users.name })
      .from(adjustments)
      .innerJoin(users, eq(users.id, adjustments.createdBy))
      .where(eq(adjustments.transactionId, id))
      .orderBy(asc(adjustments.id)),
  ]);
  const received = pays.filter((p) => countsAsReceived(p.p)).reduce((s, p) => s + p.p.amountCents, 0);
  const pending = pays.filter((p) => p.p.status === "pending").reduce((s, p) => s + p.p.amountCents, 0);
  const adjTotal = adjs.reduce((s, a) => s + a.a.amountCents, 0);
  const b = saleBalance(row.t, adjTotal, received);
  return {
    ...row.t,
    createdByName: row.createdByName,
    memberAccount: row.memberAccount,
    lines,
    payments: pays.map((p) => ({ ...p.p, receivedByName: p.name })),
    adjustments: adjs.map((a) => ({ ...a.a, createdByName: a.name })),
    ...b,
    pendingCents: pending,
  };
}

export type TransactionRow = Transaction & {
  createdByName: string;
  memberAccount: string | null;
  receivedCents: number;
  adjustmentsCents: number;
  balanceCents: number;
  methods: string[];
};

/** Per-sale money totals as SQL, so lists and balances use one definition. */
const receivedSql = sql<number>`coalesce((select sum(p.amount_cents) from payments p where p.transaction_id = ${transactions.id} and p.status <> 'bounced'), 0)::int`;
const adjustmentsSql = sql<number>`coalesce((select sum(a.amount_cents) from adjustments a where a.transaction_id = ${transactions.id}), 0)::int`;
const methodsSql = sql<string[]>`coalesce((select array_agg(distinct p.method::text) from payments p where p.transaction_id = ${transactions.id} and p.amount_cents > 0), '{}')`;

export async function listTransactions(
  db: DbLike,
  actor: Actor,
  eventId: number,
  opts: { createdBy?: number; memberId?: number; limit?: number } = {},
): Promise<TransactionRow[]> {
  assertCan(actor, "viewTransactions");
  const conds = [eq(transactions.eventId, eventId)];
  if (opts.createdBy) conds.push(eq(transactions.createdBy, opts.createdBy));
  if (opts.memberId) conds.push(eq(transactions.memberId, opts.memberId));
  const rows = await db
    .select({
      t: transactions,
      createdByName: users.name,
      memberAccount: members.accountNumber,
      receivedCents: receivedSql,
      adjustmentsCents: adjustmentsSql,
      methods: methodsSql,
    })
    .from(transactions)
    .innerJoin(users, eq(users.id, transactions.createdBy))
    .leftJoin(members, eq(members.id, transactions.memberId))
    .where(and(...conds))
    .orderBy(desc(transactions.soldAt), desc(transactions.id))
    .limit(opts.limit ?? 500);
  return rows.map((r) => ({
    ...r.t,
    createdByName: r.createdByName,
    memberAccount: r.memberAccount,
    receivedCents: r.receivedCents,
    adjustmentsCents: r.adjustmentsCents,
    balanceCents: r.t.totalCents + r.t.donationCents + r.adjustmentsCents - r.receivedCents,
    methods: r.methods,
  }));
}

export type MemberBalance = {
  memberId: number;
  accountNumber: string;
  name: string;
  provisional: boolean;
  contactConsent: boolean;
  owedCents: number;
  receivedCents: number;
  pendingCents: number;
  balanceCents: number;
  openSales: number;
};

/** Everyone with money still owed (across all events unless one is given). */
export async function listOutstanding(db: DbLike, actor: Actor, eventId?: number): Promise<MemberBalance[]> {
  assertCan(actor, "settleIous");
  const rows = await db.execute<{
    member_id: number;
    account_number: string;
    name: string;
    provisional: boolean;
    contact_consent: boolean;
    owed: number;
    received: number;
    pending: number;
    open_sales: number;
  }>(sql`
    with per_sale as (
      select t.member_id,
             t.total_cents + t.donation_cents
               + coalesce((select sum(a.amount_cents) from adjustments a where a.transaction_id = t.id), 0) as owed,
             coalesce((select sum(p.amount_cents) from payments p where p.transaction_id = t.id and p.status <> 'bounced'), 0) as received,
             coalesce((select sum(p.amount_cents) from payments p where p.transaction_id = t.id and p.status = 'pending'), 0) as pending
      from transactions t
      where t.member_id is not null ${eventId ? sql`and t.event_id = ${eventId}` : sql``}
    )
    select m.id as member_id, m.account_number, m.name, m.provisional, m.contact_consent,
           sum(s.owed)::int as owed, sum(s.received)::int as received, sum(s.pending)::int as pending,
           count(*) filter (where s.owed - s.received > 0)::int as open_sales
    from per_sale s join members m on m.id = s.member_id
    group by m.id
    having sum(s.owed - s.received) > 0
    order by sum(s.owed - s.received) desc
  `);
  return rows.rows.map((r) => ({
    memberId: r.member_id,
    accountNumber: r.account_number,
    name: r.name,
    provisional: r.provisional,
    contactConsent: r.contact_consent,
    owedCents: r.owed,
    receivedCents: r.received,
    pendingCents: r.pending,
    balanceCents: r.owed - r.received,
    openSales: r.open_sales,
  }));
}

/** Sales for one member, oldest first, with each one's balance. */
export async function memberSales(db: DbLike, memberId: number): Promise<TransactionRow[]> {
  const rows = await db
    .select({
      t: transactions,
      createdByName: users.name,
      memberAccount: members.accountNumber,
      receivedCents: receivedSql,
      adjustmentsCents: adjustmentsSql,
      methods: methodsSql,
    })
    .from(transactions)
    .innerJoin(users, eq(users.id, transactions.createdBy))
    .leftJoin(members, eq(members.id, transactions.memberId))
    .where(eq(transactions.memberId, memberId))
    .orderBy(asc(transactions.soldAt), asc(transactions.id));
  return rows.map((r) => ({
    ...r.t,
    createdByName: r.createdByName,
    memberAccount: r.memberAccount,
    receivedCents: r.receivedCents,
    adjustmentsCents: r.adjustmentsCents,
    balanceCents: r.t.totalCents + r.t.donationCents + r.adjustmentsCents - r.receivedCents,
    methods: r.methods,
  }));
}

export async function memberPayments(db: DbLike, memberId: number) {
  return db
    .select({ p: payments, receivedByName: users.name, saleId: transactions.id })
    .from(payments)
    .innerJoin(transactions, eq(transactions.id, payments.transactionId))
    .innerJoin(users, eq(users.id, payments.receivedBy))
    .where(eq(transactions.memberId, memberId))
    .orderBy(asc(payments.receivedAt), asc(payments.id));
}

// ---------------------------------------------------------------------------
// Corrections: void, refund, write-off. Nothing is deleted.
// ---------------------------------------------------------------------------

const reasonSchema = z.string().trim().min(3, "Give a short reason.").max(300);

async function lockTransaction(tx: DbLike, id: number): Promise<Transaction> {
  const [t] = await tx.select().from(transactions).where(eq(transactions.id, id)).for("update");
  if (!t) throw new UserError("That sale wasn't found.");
  return t;
}

/** Can this person void this sale? Admins: any. Cashiers: their own, recently. */
export function canVoid(actor: Actor, t: Pick<Transaction, "createdBy" | "createdAt" | "status">, now = new Date()): boolean {
  if (t.status !== "completed") return false;
  if (can(actor.role, "voidAny")) return true;
  if (!can(actor.role, "voidOwnRecent")) return false;
  return t.createdBy === actor.id && now.getTime() - t.createdAt.getTime() <= VOID_WINDOW_MINUTES * 60_000;
}

/**
 * Cancel a sale (wrong items or wrong customer). The sale stays visible as
 * voided; every payment taken is reversed with a matching negative payment,
 * meaning the money was handed back.
 */
export async function voidTransaction(db: DbLike, actor: Actor, id: number, reasonRaw: string, now = new Date()): Promise<void> {
  const reason = parseInput(reasonSchema, reasonRaw);
  await db.transaction(async (tx) => {
    const t = await lockTransaction(tx, id);
    if (t.status === "voided") throw new UserError("That sale is already voided.");
    if (!canVoid(actor, t, now)) {
      throw new ForbiddenError(`Cashiers can void their own sales within ${VOID_WINDOW_MINUTES} minutes. Ask an admin for this one.`);
    }
    const detail = (await getTransactionDetail(tx, id))!;
    // Reverse each method's net amount that still counts (bounced ones never did).
    const net = new Map<PaymentMethod, { amount: number; status: Payment["status"] }>();
    for (const p of detail.payments.filter(countsAsReceived)) {
      const cur = net.get(p.method) ?? { amount: 0, status: p.status };
      net.set(p.method, { amount: cur.amount + p.amountCents, status: p.status === "pending" ? "pending" : cur.status });
    }
    const reversals = [...net.entries()].filter(([, v]) => v.amount > 0);
    if (reversals.length) {
      await tx.insert(payments).values(
        reversals.map(([method, v]) => ({
          transactionId: id,
          memberId: t.memberId,
          method,
          amountCents: -v.amount,
          status: v.status === "pending" ? ("pending" as const) : ("received" as const),
          receivedBy: actor.id,
          note: `Returned when sale was voided: ${reason}`,
        })),
      );
    }
    const remaining = detail.owedCents;
    if (remaining > 0) {
      await tx.insert(adjustments).values({ transactionId: id, kind: "void", amountCents: -remaining, reason, createdBy: actor.id });
    }
    await tx.update(transactions).set({ status: "voided" }).where(eq(transactions.id, id));
    await writeAudit(tx, actor, {
      action: "sale.void",
      table: "transactions",
      rowId: id,
      eventId: t.eventId,
      before: { status: t.status, owedCents: detail.owedCents, receivedCents: detail.receivedCents },
      after: { status: "voided", reason, reversed: reversals.map(([m, v]) => ({ method: m, amountCents: -v.amount })) },
    });
  });
}

/**
 * Give some money back or reduce what is owed (for example, an item that was
 * spoiled). With a return method, it also records the money handed back.
 */
export async function refundTransaction(
  db: DbLike,
  actor: Actor,
  id: number,
  input: { amountCents: number; reason: string; returnMethod: PaymentMethod | null },
): Promise<void> {
  assertCan(actor, "refund");
  const reason = parseInput(reasonSchema, input.reason);
  const amount = parseInput(z.number().int().min(1, "Enter an amount."), input.amountCents);
  await db.transaction(async (tx) => {
    const t = await lockTransaction(tx, id);
    if (t.status === "voided") throw new UserError("That sale is voided, so there's nothing to refund.");
    const d = (await getTransactionDetail(tx, id))!;
    if (amount > d.owedCents) throw new UserError(`The most that can be refunded is ${(d.owedCents / 100).toFixed(2)}.`);
    if (input.returnMethod && amount > d.receivedCents) {
      throw new UserError(`Only ${(d.receivedCents / 100).toFixed(2)} has been received, so no more than that can be handed back.`);
    }
    await tx.insert(adjustments).values({ transactionId: id, kind: "refund", amountCents: -amount, reason, createdBy: actor.id });
    if (input.returnMethod) {
      await tx.insert(payments).values({
        transactionId: id,
        memberId: t.memberId,
        method: input.returnMethod,
        amountCents: -amount,
        status: "received",
        receivedBy: actor.id,
        note: `Refund: ${reason}`,
      });
    }
    await writeAudit(tx, actor, { action: "sale.refund", table: "transactions", rowId: id, eventId: t.eventId, after: { amountCents: amount, reason, returnMethod: input.returnMethod } });
  });
}

/** Close an IOU that won't be collected. Keeps the history and the reason. */
export async function writeOff(db: DbLike, actor: Actor, id: number, input: { amountCents: number; reason: string }): Promise<void> {
  assertCan(actor, "writeOff");
  const reason = parseInput(reasonSchema, input.reason);
  const amount = parseInput(z.number().int().min(1, "Enter an amount."), input.amountCents);
  await db.transaction(async (tx) => {
    const t = await lockTransaction(tx, id);
    const d = (await getTransactionDetail(tx, id))!;
    if (amount > d.balanceCents) throw new UserError(`Only ${(d.balanceCents / 100).toFixed(2)} is outstanding on this sale.`);
    await tx.insert(adjustments).values({ transactionId: id, kind: "write_off", amountCents: -amount, reason, createdBy: actor.id });
    await writeAudit(tx, actor, { action: "sale.write_off", table: "transactions", rowId: id, eventId: t.eventId, after: { amountCents: amount, reason } });
  });
}

// ---------------------------------------------------------------------------
// IOU payments and confirming Venmo / checks
// ---------------------------------------------------------------------------

const settleInput = z.object({
  method: z.enum(["cash", "venmo", "check"]),
  amountCents: z.number().int().min(1, "Enter an amount.").max(10_000_000),
  reference: z.string().trim().max(100).nullish().transform((v) => v || null),
  note: z.string().trim().max(300).nullish().transform((v) => v || null),
});

/**
 * Record money a member paid towards what they owe. It is applied to their
 * oldest unpaid sale first, and can cover several sales.
 */
export async function settleMemberBalance(db: DbLike, actor: Actor, memberId: number, input: unknown): Promise<{ applied: { transactionId: number; amountCents: number }[] }> {
  assertCan(actor, "settleIous");
  const data = parseInput(settleInput, input);
  if (data.method === "check" && !data.reference) throw new UserError("Enter the check number.");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(72710100, ${memberId})`);
    const open = (await memberSales(tx, memberId)).filter((s) => s.balanceCents > 0);
    const owed = open.reduce((s, t) => s + t.balanceCents, 0);
    if (owed === 0) throw new UserError("This member doesn't owe anything.");
    if (data.amountCents > owed) throw new UserError(`That's more than the ${(owed / 100).toFixed(2)} they owe.`);
    const settlementId = randomUUID();
    let left = data.amountCents;
    const applied: { transactionId: number; amountCents: number }[] = [];
    for (const s of open) {
      if (left === 0) break;
      const part = Math.min(left, s.balanceCents);
      applied.push({ transactionId: s.id, amountCents: part });
      left -= part;
    }
    await tx.insert(payments).values(
      applied.map((a) => ({
        transactionId: a.transactionId,
        memberId,
        method: data.method,
        amountCents: a.amountCents,
        reference: data.reference,
        status: (data.method === "cash" ? "received" : "pending") as Payment["status"],
        receivedBy: actor.id,
        settlementId,
        note: data.note,
      })),
    );
    await writeAudit(tx, actor, { action: "iou.payment", table: "payments", rowId: settlementId, after: { memberId, ...data, applied } });
    return { applied };
  });
}

/**
 * Confirm a Venmo or check payment arrived ("cleared"), or record that a check
 * bounced, which reopens the balance.
 */
export async function setPaymentStatus(db: DbLike, actor: Actor, paymentId: number, status: "cleared" | "bounced" | "pending", now = new Date()): Promise<void> {
  assertCan(actor, "clearPayments");
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!before) throw new UserError("That payment wasn't found.");
    if (before.method === "cash") throw new UserError("Cash is counted as received when it's taken.");
    if (before.amountCents < 0) throw new UserError("Money handed back can't be cleared or bounced.");
    if (status === "bounced" && before.method !== "check") throw new UserError("Only checks can bounce. For Venmo, void or write off instead.");
    const [after] = await tx
      .update(payments)
      .set({ status, clearedAt: status === "cleared" ? now : null, clearedBy: status === "cleared" ? actor.id : null })
      .where(eq(payments.id, paymentId))
      .returning();
    const [t] = await tx.select({ eventId: transactions.eventId }).from(transactions).where(eq(transactions.id, before.transactionId));
    await writeAudit(tx, actor, { action: `payment.${status}`, table: "payments", rowId: paymentId, eventId: t?.eventId, before, after });
  });
}

/** Venmo and check payments still waiting for an admin to confirm. */
export async function listPendingPayments(db: DbLike, actor: Actor, eventId?: number) {
  assertCan(actor, "clearPayments");
  const conds = [eq(payments.status, "pending"), ne(payments.method, "cash"), sql`${payments.amountCents} > 0`];
  if (eventId) conds.push(eq(transactions.eventId, eventId));
  return db
    .select({ p: payments, customerName: transactions.customerName, saleId: transactions.id, eventId: transactions.eventId, receivedByName: users.name })
    .from(payments)
    .innerJoin(transactions, eq(transactions.id, payments.transactionId))
    .innerJoin(users, eq(users.id, payments.receivedBy))
    .where(and(...conds))
    .orderBy(asc(payments.receivedAt));
}
