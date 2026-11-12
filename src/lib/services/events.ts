import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DbLike } from "@/db";
import { events, items, stations, type Event, type EventStatus } from "@/db/schema";
import { UserError } from "../errors";
import { assertCan, type Actor } from "../permissions";
import { parseInput } from "../validate";
import { writeAudit } from "./audit";

const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-03-14.")
  .or(z.literal(""))
  .nullish()
  .transform((v) => v || null);

const eventInput = z.object({
  name: z.string().trim().min(1, "Give the event a name, like Bake Sale 2027.").max(100),
  saleDate: dateSchema,
  notes: z.string().trim().max(2000).nullish().transform((v) => v || null),
});


export async function listEvents(db: DbLike): Promise<Event[]> {
  return db.select().from(events).orderBy(desc(events.saleDate), desc(events.createdAt));
}

export async function getEvent(db: DbLike, id: number): Promise<Event | null> {
  const [e] = await db.select().from(events).where(eq(events.id, id));
  return e ?? null;
}

/**
 * Lock an event row for the rest of the transaction and make sure it can still
 * be changed. Closed events are read-only history.
 */
export async function lockEditableEvent(tx: DbLike, eventId: number): Promise<Event> {
  const [e] = await tx.select().from(events).where(eq(events.id, eventId)).for("update");
  if (!e) throw new UserError("That event no longer exists.");
  return e;
}

/**
 * Codes can always be changed: one person runs the sale and reprints the code
 * sheet if needed. Past checkouts keep the code they were sold under.
 */
export function codesAreLocked(_e: Pick<Event, "status">): boolean {
  return false;
}

/**
 * Create an event. With copyFromEventId, its stations and items come along
 * (same codes, names, prices and units; stock counts start empty).
 */
export async function createEvent(
  db: DbLike,
  actor: Actor,
  input: unknown,
  copyFromEventId?: number | null,
): Promise<Event> {
  assertCan(actor, "manageEvents");
  const data = parseInput(eventInput, input);
  return db.transaction(async (tx) => {
    const [ev] = await tx
      .insert(events)
      .values({ ...data, status: "draft", copiedFromEventId: copyFromEventId ?? null })
      .returning();
    await writeAudit(tx, actor, { action: "event.create", table: "events", rowId: ev.id, eventId: ev.id, after: ev });

    if (copyFromEventId) {
      const source = await getEvent(tx, copyFromEventId);
      if (!source) throw new UserError("The event to copy from no longer exists.");
      const oldStations = await tx.select().from(stations).where(eq(stations.eventId, source.id)).orderBy(asc(stations.sortOrder));
      const stationMap = new Map<number, number>();
      for (const s of oldStations) {
        const [ns] = await tx
          .insert(stations)
          .values({ eventId: ev.id, name: s.name, codePrefix: s.codePrefix, sortOrder: s.sortOrder })
          .returning();
        stationMap.set(s.id, ns.id);
      }
      const oldItems = await tx.select().from(items).where(eq(items.eventId, source.id)).orderBy(asc(items.code));
      if (oldItems.length) {
        await tx.insert(items).values(
          oldItems.map((it) => ({
            eventId: ev.id,
            code: it.code,
            name: it.name,
            category: it.category,
            unit: it.unit,
            unitPriceCents: it.unitPriceCents,
            expectedQty: it.expectedQty,
            availableQty: null,
            stationId: it.stationId ? (stationMap.get(it.stationId) ?? null) : null,
            active: it.active,
            sourceItemId: it.id,
          })),
        );
      }
      await writeAudit(tx, actor, {
        action: "event.copy_catalog",
        table: "events",
        rowId: ev.id,
        eventId: ev.id,
        after: { fromEventId: source.id, stations: oldStations.length, items: oldItems.length },
      });
    }
    return ev;
  });
}

export async function updateEvent(db: DbLike, actor: Actor, eventId: number, input: unknown): Promise<Event> {
  assertCan(actor, "manageEvents");
  const data = parseInput(eventInput, input);
  return db.transaction(async (tx) => {
    const before = await lockEditableEvent(tx, eventId);
    const [after] = await tx.update(events).set(data).where(eq(events.id, eventId)).returning();
    await writeAudit(tx, actor, { action: "event.update", table: "events", rowId: eventId, eventId, before, after });
    return after;
  });
}

const ALLOWED_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  // Going back from open to draft would unlock item codes after slips were printed.
  draft: ["open"],
  open: ["closed"],
  closed: ["open"],
};

export async function setEventStatus(db: DbLike, actor: Actor, eventId: number, status: EventStatus): Promise<Event> {
  assertCan(actor, "manageEvents");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(events).where(eq(events.id, eventId)).for("update");
    if (!before) throw new UserError("That event no longer exists.");
    if (before.status === status) return before;
    if (!ALLOWED_TRANSITIONS[before.status].includes(status)) {
      throw new UserError(`An event that is ${before.status} can't be changed to ${status}.`);
    }
    const [after] = await tx.update(events).set({ status }).where(eq(events.id, eventId)).returning();
    await writeAudit(tx, actor, { action: `event.${status}`, table: "events", rowId: eventId, eventId, before, after });
    return after;
  });
}
