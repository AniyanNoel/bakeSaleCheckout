import { asc, eq, max } from "drizzle-orm";
import { z } from "zod";
import type { DbLike } from "@/db";
import { items, stations, type Station } from "@/db/schema";
import { nextStationPrefix, UNASSIGNED_PREFIX } from "../codes";
import { UserError, isUniqueViolation } from "../errors";
import { assertCan, type Actor } from "../permissions";
import { parseInput } from "../validate";
import { writeAudit } from "./audit";
import { codesAreLocked, lockEditableEvent } from "./events";

const stationInput = z.object({
  name: z.string().trim().min(1, "Give the station a name.").max(60),
  codePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,2}$/, "The code letter must be one or two letters, like A or BB.")
    .refine((p) => p !== UNASSIGNED_PREFIX, `${UNASSIGNED_PREFIX} is kept for items without a station.`)
    .or(z.literal(""))
    .nullish(),
});


function friendlyUnique(err: unknown): never {
  if (isUniqueViolation(err, "stations_event_prefix_key")) throw new UserError("Another station already uses that code letter.");
  if (isUniqueViolation(err, "stations_event_name_key")) throw new UserError("Another station already has that name.");
  throw err;
}

export async function listStations(db: DbLike, eventId: number): Promise<Station[]> {
  return db.select().from(stations).where(eq(stations.eventId, eventId)).orderBy(asc(stations.sortOrder), asc(stations.codePrefix));
}

export async function createStation(db: DbLike, actor: Actor, eventId: number, input: unknown): Promise<Station> {
  assertCan(actor, "manageEvents");
  const data = parseInput(stationInput, input);
  try {
    return await db.transaction(async (tx) => {
      await lockEditableEvent(tx, eventId);
      const existing = await listStations(tx, eventId);
      const prefix = data.codePrefix || nextStationPrefix(existing.map((s) => s.codePrefix));
      const [{ m }] = await tx.select({ m: max(stations.sortOrder) }).from(stations).where(eq(stations.eventId, eventId));
      const [s] = await tx
        .insert(stations)
        .values({ eventId, name: data.name, codePrefix: prefix, sortOrder: (m ?? 0) + 1 })
        .returning();
      await writeAudit(tx, actor, { action: "station.create", table: "stations", rowId: s.id, eventId, after: s });
      return s;
    });
  } catch (err) {
    friendlyUnique(err);
  }
}

export async function updateStation(db: DbLike, actor: Actor, stationId: number, input: unknown): Promise<Station> {
  assertCan(actor, "manageEvents");
  const data = parseInput(stationInput, input);
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(stations).where(eq(stations.id, stationId));
      if (!before) throw new UserError("That station no longer exists.");
      const ev = await lockEditableEvent(tx, before.eventId);
      const prefix = data.codePrefix || before.codePrefix;
      if (prefix !== before.codePrefix && codesAreLocked(ev)) {
        throw new UserError("The sale is open, so code letters can't change any more.");
      }
      const [after] = await tx.update(stations).set({ name: data.name, codePrefix: prefix }).where(eq(stations.id, stationId)).returning();
      await writeAudit(tx, actor, { action: "station.update", table: "stations", rowId: stationId, eventId: ev.id, before, after });
      return after;
    });
  } catch (err) {
    friendlyUnique(err);
  }
}

/** Only while the event is a draft. Its items stay, without a station. */
export async function deleteStation(db: DbLike, actor: Actor, stationId: number): Promise<void> {
  assertCan(actor, "manageEvents");
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(stations).where(eq(stations.id, stationId));
    if (!before) return;
    const ev = await lockEditableEvent(tx, before.eventId);
    if (codesAreLocked(ev)) throw new UserError("The sale is open, so stations can't be removed. Rename it instead.");
    const moved = await tx.update(items).set({ stationId: null }).where(eq(items.stationId, stationId)).returning({ id: items.id });
    await tx.delete(stations).where(eq(stations.id, stationId));
    await writeAudit(tx, actor, {
      action: "station.delete",
      table: "stations",
      rowId: stationId,
      eventId: ev.id,
      before,
      after: { itemsUnassigned: moved.map((m) => m.id) },
    });
  });
}
