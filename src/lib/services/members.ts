import { asc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbLike } from "@/db";
import { members, type Member } from "@/db/schema";
import { UserError, isUniqueViolation } from "../errors";
import { assertCan, type Actor } from "../permissions";
import { parseInput } from "../validate";
import { writeAudit } from "./audit";

/**
 * Account number format isn't decided yet, so any short text is accepted.
 * It is trimmed and upper-cased so "smc-12" and "SMC-12 " are the same account.
 */
export function normalizeAccount(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toUpperCase();
}

const accountSchema = z
  .string()
  .transform(normalizeAccount)
  .pipe(z.string().min(1, "Enter the account number.").max(30, "That account number is too long."));

const memberInput = z.object({
  accountNumber: accountSchema,
  name: z.string().trim().min(1, "Enter the member's name.").max(100),
});

/** What cashiers may see: no contact details. */
export type MemberSummary = Pick<Member, "id" | "accountNumber" | "name" | "provisional">;

const summaryCols = { id: members.id, accountNumber: members.accountNumber, name: members.name, provisional: members.provisional };

export async function findMemberByAccount(db: DbLike, accountNumber: string): Promise<MemberSummary | null> {
  const [m] = await db.select(summaryCols).from(members).where(eq(members.accountNumber, normalizeAccount(accountNumber)));
  return m ?? null;
}

/** Every active member's number and name, for the checkout screen's offline lookup. */
export async function listMemberSummaries(db: DbLike, actor: Actor): Promise<MemberSummary[]> {
  assertCan(actor, "lookupMembers");
  return db.select(summaryCols).from(members).where(eq(members.active, true)).orderBy(asc(members.name));
}

export async function searchMembers(db: DbLike, actor: Actor, q: string): Promise<MemberSummary[]> {
  assertCan(actor, "lookupMembers");
  const term = q.trim();
  if (!term) return [];
  return db
    .select(summaryCols)
    .from(members)
    .where(or(ilike(members.name, `%${term.replace(/[%_]/g, "")}%`), eq(members.accountNumber, normalizeAccount(term))))
    .orderBy(asc(members.name))
    .limit(20);
}

/**
 * Used at checkout: find the member by account number, or add them as a
 * provisional member for an admin to confirm later.
 */
export async function findOrCreateMemberAtCheckout(
  tx: DbLike,
  actor: Actor,
  input: { accountNumber: string; name: string },
): Promise<{ member: MemberSummary; created: boolean; nameDiffers: boolean }> {
  assertCan(actor, "checkout");
  const data = parseInput(memberInput, input);
  const existing = await findMemberByAccount(tx, data.accountNumber);
  if (existing) {
    const nameDiffers = existing.name.trim().toLowerCase() !== data.name.trim().toLowerCase();
    return { member: existing, created: false, nameDiffers };
  }
  const [m] = await tx
    .insert(members)
    .values({ accountNumber: data.accountNumber, name: data.name, provisional: true, createdBy: actor.id })
    .onConflictDoNothing()
    .returning(summaryCols);
  if (!m) {
    // Another checkout created the same account a moment ago.
    const again = await findMemberByAccount(tx, data.accountNumber);
    if (!again) throw new UserError("Couldn't add that member. Please try again.");
    return { member: again, created: false, nameDiffers: false };
  }
  await writeAudit(tx, actor, { action: "member.create_provisional", table: "members", rowId: m.id, after: m });
  return { member: m, created: true, nameDiffers: false };
}

export async function listMembers(db: DbLike, actor: Actor): Promise<Member[]> {
  assertCan(actor, "manageMembers");
  return db.select().from(members).orderBy(sql`${members.provisional} desc`, asc(members.name));
}

export async function getMember(db: DbLike, actor: Actor, id: number): Promise<Member | null> {
  assertCan(actor, "lookupMembers");
  const [m] = await db.select().from(members).where(eq(members.id, id));
  if (!m) return null;
  // Cashiers never receive contact details.
  if (actor.role !== "admin") return { ...m, phone: null, email: null, contactConsentNote: null };
  return m;
}

const memberEdit = memberInput.extend({
  phone: z.string().trim().max(30).nullish().transform((v) => v || null),
  email: z.string().trim().max(120).nullish().transform((v) => v || null),
  contactConsent: z.boolean(),
  contactConsentNote: z.string().trim().max(300).nullish().transform((v) => v || null),
  active: z.boolean().default(true),
});

export async function createMember(db: DbLike, actor: Actor, input: unknown): Promise<Member> {
  assertCan(actor, "manageMembers");
  const data = parseInput(memberEdit, input);
  if ((data.phone || data.email) && !data.contactConsent) {
    throw new UserError("Only save a phone or email when the member has agreed. Tick the consent box and note how they agreed.");
  }
  try {
    return await db.transaction(async (tx) => {
      const [m] = await tx.insert(members).values({ ...data, provisional: false, createdBy: actor.id }).returning();
      await writeAudit(tx, actor, { action: "member.create", table: "members", rowId: m.id, after: m });
      return m;
    });
  } catch (err) {
    if (isUniqueViolation(err, "members_account_key")) throw new UserError("Another member already has that account number.");
    throw err;
  }
}

/** Edit details. Saving also confirms a provisional member. */
export async function updateMember(db: DbLike, actor: Actor, id: number, input: unknown): Promise<Member> {
  assertCan(actor, "manageMembers");
  const data = parseInput(memberEdit, input);
  if ((data.phone || data.email) && !data.contactConsent) {
    throw new UserError("Only save a phone or email when the member has agreed. Tick the consent box and note how they agreed.");
  }
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(members).where(eq(members.id, id)).for("update");
      if (!before) throw new UserError("That member no longer exists.");
      const [after] = await tx
        .update(members)
        .set({ ...data, provisional: false })
        .where(eq(members.id, id))
        .returning();
      await writeAudit(tx, actor, { action: "member.update", table: "members", rowId: id, before, after });
      return after;
    });
  } catch (err) {
    if (isUniqueViolation(err, "members_account_key")) throw new UserError("Another member already has that account number.");
    throw err;
  }
}
