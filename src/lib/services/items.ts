import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DbLike } from "@/db";
import { items, stations, type Item, type Station } from "@/db/schema";
import { formatCode, isValidCode, nextCode, normalizeCode, UNASSIGNED_PREFIX } from "../codes";
import { UserError, isUniqueViolation } from "../errors";
import { parseDollarsToCents } from "../money";
import { assertCan, type Actor } from "../permissions";
import { parseInput } from "../validate";
import { writeAudit } from "./audit";
import { codesAreLocked, lockEditableEvent } from "./events";

const optionalCount = (label: string) =>
  z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((v, ctx) => {
      if (v === null || v === undefined || String(v).trim() === "") return null;
      const n = Number(String(v).trim());
      if (!Number.isInteger(n) || n < 0 || n > 100000) {
        ctx.addIssue({ code: "custom", message: `${label} must be a whole number, 0 or more.` });
        return z.NEVER;
      }
      return n;
    });

const itemInput = z.object({
  code: z.string().nullish().transform((v) => (v ? normalizeCode(v) : null)),
  name: z.string().trim().min(1, "Item name is required.").max(120),
  category: z.string().trim().max(60).nullish().transform((v) => v || null),
  unit: z.string().trim().max(30).nullish().transform((v) => v || "each"),
  price: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((v, ctx) => {
      const cents = parseDollarsToCents(v);
      if (cents === undefined) {
        ctx.addIssue({ code: "custom", message: "Price should look like 5 or 5.50." });
        return z.NEVER;
      }
      if (cents !== null && cents > 1_000_000) {
        ctx.addIssue({ code: "custom", message: "That price looks too high." });
        return z.NEVER;
      }
      return cents;
    }),
  expectedQty: optionalCount("Expected quantity"),
  availableQty: optionalCount("Available quantity"),
  stationId: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((v) => (v === null || v === undefined || v === "" ? null : Number(v))),
  active: z.boolean().default(true),
});
export type ItemInput = z.input<typeof itemInput>;

function friendlyUnique(err: unknown): never {
  if (isUniqueViolation(err, "items_event_code_key")) throw new UserError("Another item in this event already has that code.");
  throw err;
}

export type ItemRow = Item & { station: Station | null };

/** Items with their station, in code order. */
export async function listItems(db: DbLike, eventId: number): Promise<ItemRow[]> {
  const rows = await db
    .select({ item: items, station: stations })
    .from(items)
    .leftJoin(stations, eq(stations.id, items.stationId))
    .where(eq(items.eventId, eventId))
    .orderBy(asc(items.code));
  return rows.map((r) => ({ ...r.item, station: r.station }));
}

export async function getItem(db: DbLike, itemId: number): Promise<Item | null> {
  const [it] = await db.select().from(items).where(eq(items.id, itemId));
  return it ?? null;
}

/** Things an admin should look at before the sale. */
export function itemWarnings(it: Pick<Item, "unitPriceCents" | "stationId" | "active">): string[] {
  const w: string[] = [];
  if (it.unitPriceCents === null) w.push("No price");
  else if (it.unitPriceCents === 0) w.push("Price is $0");
  if (it.stationId === null) w.push("No station");
  return w;
}

async function stationFor(tx: DbLike, eventId: number, stationId: number | null): Promise<Station | null> {
  if (stationId === null) return null;
  const [s] = await tx.select().from(stations).where(and(eq(stations.id, stationId), eq(stations.eventId, eventId)));
  if (!s) throw new UserError("That table isn't part of this event.");
  return s;
}

async function eventCodes(tx: DbLike, eventId: number): Promise<string[]> {
  const rows = await tx.select({ code: items.code }).from(items).where(eq(items.eventId, eventId));
  return rows.map((r) => r.code);
}

export async function createItem(db: DbLike, actor: Actor, eventId: number, input: unknown): Promise<Item> {
  assertCan(actor, "manageItems");
  const data = parseInput(itemInput, input);
  try {
    return await db.transaction(async (tx) => {
      await lockEditableEvent(tx, eventId);
      const station = await stationFor(tx, eventId, data.stationId);
      let code = data.code;
      if (code) {
        if (!isValidCode(code)) throw new UserError("Codes are one or two letters then a number, like A01.");
      } else {
        code = nextCode(station?.codePrefix ?? UNASSIGNED_PREFIX, await eventCodes(tx, eventId));
      }
      const [it] = await tx
        .insert(items)
        .values({
          eventId,
          code,
          name: data.name,
          category: data.category,
          unit: data.unit,
          unitPriceCents: data.price,
          expectedQty: data.expectedQty,
          availableQty: data.availableQty,
          stationId: station?.id ?? null,
          active: data.active,
        })
        .returning();
      await writeAudit(tx, actor, { action: "item.create", table: "items", rowId: it.id, eventId, after: it });
      return it;
    });
  } catch (err) {
    friendlyUnique(err);
  }
}

export async function updateItem(db: DbLike, actor: Actor, itemId: number, input: unknown): Promise<Item> {
  assertCan(actor, "manageItems");
  const data = parseInput(itemInput, input);
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(items).where(eq(items.id, itemId)).for("update");
      if (!before) throw new UserError("That item no longer exists.");
      const ev = await lockEditableEvent(tx, before.eventId);
      const station = await stationFor(tx, ev.id, data.stationId);
      const code = data.code || before.code;
      if (code !== before.code) {
        if (codesAreLocked(ev)) throw new UserError("The sale is open, so item codes can't change any more.");
        if (!isValidCode(code)) throw new UserError("Codes are one or two letters then a number, like A01.");
      }
      const [after] = await tx
        .update(items)
        .set({
          code,
          name: data.name,
          category: data.category,
          unit: data.unit,
          unitPriceCents: data.price,
          expectedQty: data.expectedQty,
          availableQty: data.availableQty,
          stationId: station?.id ?? null,
          active: data.active,
          updatedAt: new Date(),
        })
        .where(eq(items.id, itemId))
        .returning();
      await writeAudit(tx, actor, { action: "item.update", table: "items", rowId: itemId, eventId: ev.id, before, after });
      return after;
    });
  } catch (err) {
    friendlyUnique(err);
  }
}

export async function setItemActive(db: DbLike, actor: Actor, itemId: number, active: boolean): Promise<void> {
  assertCan(actor, "manageItems");
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(items).where(eq(items.id, itemId)).for("update");
    if (!before) throw new UserError("That item no longer exists.");
    await lockEditableEvent(tx, before.eventId);
    const [after] = await tx.update(items).set({ active, updatedAt: new Date() }).where(eq(items.id, itemId)).returning();
    await writeAudit(tx, actor, { action: active ? "item.activate" : "item.deactivate", table: "items", rowId: itemId, eventId: before.eventId, before, after });
  });
}

/**
 * Remove an item entirely. Only while the event is a draft (nothing has been
 * sold); once the sale is open, items are deactivated instead so history stays.
 */
export async function deleteItem(db: DbLike, actor: Actor, itemId: number): Promise<void> {
  assertCan(actor, "manageItems");
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(items).where(eq(items.id, itemId)).for("update");
    if (!before) return;
    const ev = await lockEditableEvent(tx, before.eventId);
    if (codesAreLocked(ev)) throw new UserError("The sale is open, so items can't be removed. Mark it inactive instead.");
    await tx.delete(items).where(eq(items.id, itemId));
    await writeAudit(tx, actor, { action: "item.delete", table: "items", rowId: itemId, eventId: ev.id, before });
  });
}

/**
 * Give every item a fresh code from its station letter: A01, A02, B01 ...
 * Only while the event is a draft. Order within a station follows the current code.
 */
export async function renumberCodes(db: DbLike, actor: Actor, eventId: number): Promise<{ changed: number }> {
  assertCan(actor, "manageItems");
  return db.transaction(async (tx) => {
    const ev = await lockEditableEvent(tx, eventId);
    if (codesAreLocked(ev)) throw new UserError("The sale is open, so item codes can't change any more.");
    const all = await listItems(tx, eventId);
    const groups = new Map<string, ItemRow[]>();
    for (const it of all) {
      const prefix = it.station?.codePrefix ?? UNASSIGNED_PREFIX;
      if (!groups.has(prefix)) groups.set(prefix, []);
      groups.get(prefix)!.push(it);
    }
    const plan: { id: number; from: string; to: string }[] = [];
    for (const [prefix, group] of groups) {
      group.forEach((it, i) => plan.push({ id: it.id, from: it.code, to: formatCode(prefix, i + 1) }));
    }
    const changes = plan.filter((p) => p.from !== p.to);
    // Two passes so swapping codes never trips the unique constraint.
    for (const c of changes) await tx.update(items).set({ code: `~${c.id}` }).where(eq(items.id, c.id));
    for (const c of changes) await tx.update(items).set({ code: c.to, updatedAt: new Date() }).where(eq(items.id, c.id));
    if (changes.length) {
      await writeAudit(tx, actor, { action: "item.renumber_codes", table: "items", eventId, after: { changes } });
    }
    return { changed: changes.length };
  });
}
