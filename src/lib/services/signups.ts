import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbLike } from "@/db";
import { items, signups, stations, volunteers, type Signup, type Volunteer } from "@/db/schema";
import { ABSOLUTE_SIGNUP_MAX, NORMAL_SIGNUP_MAX } from "../constants";
import { UserError } from "../errors";
import { assertCan, type Actor } from "../permissions";
import { parseInput } from "../validate";
import { writeAudit } from "./audit";
import { lockEditableEvent } from "./events";

const qtySchema = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const n = Number(String(v).trim());
    if (!Number.isInteger(n) || n < 1) {
      ctx.addIssue({ code: "custom", message: "Quantity must be a whole number, 1 or more." });
      return z.NEVER;
    }
    return n;
  });

const signupInput = z.object({
  volunteerName: z.string().trim().min(1, "Enter the volunteer's name.").max(100),
  qty: qtySchema,
  allowLarge: z.boolean().default(false),
  note: z.string().trim().max(300).nullish().transform((v) => v || null),
});

/** 1 to 100 is normal; above that needs the "large quantity" box ticked. */
export function checkSignupQty(qty: number, allowLarge: boolean): void {
  if (qty > ABSOLUTE_SIGNUP_MAX) throw new UserError(`Quantities above ${ABSOLUTE_SIGNUP_MAX} aren't accepted.`);
  if (qty > NORMAL_SIGNUP_MAX && !allowLarge) {
    throw new UserError(`${qty} is more than ${NORMAL_SIGNUP_MAX}. Tick "large quantity" if that's right.`);
  }
}

/** Match an existing volunteer by name (ignoring case and spacing) or add a new one. */
export async function findOrCreateVolunteer(tx: DbLike, name: string): Promise<Volunteer> {
  const clean = name.trim().replace(/\s+/g, " ");
  const [found] = await tx
    .select()
    .from(volunteers)
    .where(sql`lower(${volunteers.name}) = lower(${clean})`)
    .orderBy(asc(volunteers.id))
    .limit(1);
  if (found) return found;
  const [created] = await tx.insert(volunteers).values({ name: clean }).returning();
  return created;
}

async function lockItemEvent(tx: DbLike, itemId: number) {
  const [it] = await tx.select().from(items).where(eq(items.id, itemId));
  if (!it) throw new UserError("That item no longer exists.");
  const ev = await lockEditableEvent(tx, it.eventId);
  return { item: it, event: ev };
}

export async function addSignup(db: DbLike, actor: Actor, itemId: number, input: unknown): Promise<Signup> {
  assertCan(actor, "manageSignups");
  const data = parseInput(signupInput, input);
  checkSignupQty(data.qty, data.allowLarge);
  return db.transaction(async (tx) => {
    const { event } = await lockItemEvent(tx, itemId);
    const vol = await findOrCreateVolunteer(tx, data.volunteerName);
    const [s] = await tx
      .insert(signups)
      .values({ itemId, volunteerId: vol.id, committedQty: data.qty, note: data.note })
      .returning();
    await writeAudit(tx, actor, { action: "signup.create", table: "signups", rowId: s.id, eventId: event.id, after: { ...s, volunteerName: vol.name } });
    return s;
  });
}

export async function updateSignup(
  db: DbLike,
  actor: Actor,
  signupId: number,
  input: { qty: string | number; allowLarge?: boolean; note?: string | null },
): Promise<Signup> {
  assertCan(actor, "manageSignups");
  const data = parseInput(signupInput.omit({ volunteerName: true }), input);
  checkSignupQty(data.qty, data.allowLarge);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(signups).where(eq(signups.id, signupId)).for("update");
    if (!before) throw new UserError("That signup no longer exists.");
    const { event } = await lockItemEvent(tx, before.itemId);
    const [after] = await tx.update(signups).set({ committedQty: data.qty, note: data.note }).where(eq(signups.id, signupId)).returning();
    await writeAudit(tx, actor, { action: "signup.update", table: "signups", rowId: signupId, eventId: event.id, before, after });
    return after;
  });
}

export async function removeSignup(db: DbLike, actor: Actor, signupId: number): Promise<void> {
  assertCan(actor, "manageSignups");
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(signups).where(eq(signups.id, signupId)).for("update");
    if (!before) return;
    const { event } = await lockItemEvent(tx, before.itemId);
    await tx.delete(signups).where(eq(signups.id, signupId));
    await writeAudit(tx, actor, { action: "signup.delete", table: "signups", rowId: signupId, eventId: event.id, before });
  });
}

export type SignupRow = Signup & { volunteerName: string; itemId: number };

export async function listSignupsForEvent(db: DbLike, eventId: number): Promise<SignupRow[]> {
  const rows = await db
    .select({ s: signups, volunteerName: volunteers.name })
    .from(signups)
    .innerJoin(items, eq(items.id, signups.itemId))
    .innerJoin(volunteers, eq(volunteers.id, signups.volunteerId))
    .where(eq(items.eventId, eventId))
    .orderBy(asc(signups.id));
  return rows.map((r) => ({ ...r.s, volunteerName: r.volunteerName }));
}

export type BringListEntry = {
  volunteerId: number;
  volunteerName: string;
  lines: { code: string; itemName: string; unit: string; qty: number | null; station: string | null; note: string | null }[];
};

/** What each volunteer has signed up to bring, for printing. */
export async function bringList(db: DbLike, eventId: number): Promise<BringListEntry[]> {
  const rows = await db
    .select({
      volunteerId: volunteers.id,
      volunteerName: volunteers.name,
      code: items.code,
      itemName: items.name,
      unit: items.unit,
      qty: signups.committedQty,
      note: signups.note,
      station: stations.name,
    })
    .from(signups)
    .innerJoin(items, eq(items.id, signups.itemId))
    .innerJoin(volunteers, eq(volunteers.id, signups.volunteerId))
    .leftJoin(stations, eq(stations.id, items.stationId))
    .where(and(eq(items.eventId, eventId)))
    .orderBy(asc(sql`lower(${volunteers.name})`), asc(items.code));
  const byVol = new Map<number, BringListEntry>();
  for (const r of rows) {
    if (!byVol.has(r.volunteerId)) byVol.set(r.volunteerId, { volunteerId: r.volunteerId, volunteerName: r.volunteerName, lines: [] });
    byVol.get(r.volunteerId)!.lines.push({ code: r.code, itemName: r.itemName, unit: r.unit, qty: r.qty, station: r.station, note: r.note });
  }
  return [...byVol.values()];
}

export async function listVolunteerNames(db: DbLike): Promise<string[]> {
  const rows = await db.select({ name: volunteers.name }).from(volunteers).orderBy(asc(sql`lower(${volunteers.name})`));
  return [...new Set(rows.map((r) => r.name))];
}
