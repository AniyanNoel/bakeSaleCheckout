import { asc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import type { DbLike } from "@/db";
import { members, type Member } from "@/db/schema";
import { UserError, isUniqueViolation } from "../errors";
import { assertCan, type Actor } from "../permissions";
import { parseInput } from "../validate";
import { writeAudit } from "./audit";

/** Church account numbers, e.g. "9". Trimmed and upper-cased so " 9" and "9" match. */
export function normalizeAccount(raw: string): string {
  return String(raw ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

const accountSchema = z
  .string()
  .transform(normalizeAccount)
  .pipe(z.string().min(1, "Enter the account number.").max(30, "That account number is too long."));

const personInput = z.object({
  accountNumber: accountSchema,
  name: z.string().trim().min(1, "Enter the name.").max(100),
});

export type Person = Pick<Member, "id" | "accountNumber" | "name">;
const cols = { id: members.id, accountNumber: members.accountNumber, name: members.name };

function friendly(err: unknown): never {
  if (isUniqueViolation(err, "members_account_key")) throw new UserError("Someone already has that account number.");
  throw err;
}

export async function listPeople(db: DbLike, actor: Actor, q = ""): Promise<Person[]> {
  assertCan(actor, "manageMembers");
  const term = q.trim().replace(/[%_]/g, "");
  const base = db.select(cols).from(members);
  const rows = term
    ? await base.where(or(ilike(members.name, `%${term}%`), eq(members.accountNumber, normalizeAccount(term))))
    : await base;
  // Account numbers sort as numbers when they are numbers: 2 before 10.
  return rows.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber, undefined, { numeric: true }));
}

export async function findPersonByAccount(db: DbLike, accountNumber: string): Promise<Person | null> {
  const [m] = await db.select(cols).from(members).where(eq(members.accountNumber, normalizeAccount(accountNumber)));
  return m ?? null;
}

export async function getPerson(db: DbLike, actor: Actor, id: number): Promise<Person | null> {
  assertCan(actor, "manageMembers");
  const [m] = await db.select(cols).from(members).where(eq(members.id, id));
  return m ?? null;
}

export async function createPerson(db: DbLike, actor: Actor, input: unknown): Promise<Person> {
  assertCan(actor, "manageMembers");
  const data = parseInput(personInput, input);
  try {
    return await db.transaction(async (tx) => {
      const [m] = await tx.insert(members).values(data).returning(cols);
      await writeAudit(tx, actor, { action: "person.create", table: "members", rowId: m.id, after: m });
      return m;
    });
  } catch (err) {
    friendly(err);
  }
}

export async function updatePerson(db: DbLike, actor: Actor, id: number, input: unknown): Promise<Person> {
  assertCan(actor, "manageMembers");
  const data = parseInput(personInput, input);
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select(cols).from(members).where(eq(members.id, id)).for("update");
      if (!before) throw new UserError("That person is no longer in the list.");
      const [after] = await tx.update(members).set(data).where(eq(members.id, id)).returning(cols);
      await writeAudit(tx, actor, { action: "person.update", table: "members", rowId: id, before, after });
      return after;
    });
  } catch (err) {
    friendly(err);
  }
}

/** Removes someone from the list. Their past checkouts keep the name and number they had. */
export async function deletePerson(db: DbLike, actor: Actor, id: number): Promise<void> {
  assertCan(actor, "manageMembers");
  await db.transaction(async (tx) => {
    const [before] = await tx.delete(members).where(eq(members.id, id)).returning(cols);
    if (before) await writeAudit(tx, actor, { action: "person.delete", table: "members", rowId: id, before });
  });
}

export type DirectoryRow = { accountNumber: string; name: string };
export type DirectoryImportResult = { added: number; updated: number; unchanged: number; skipped: string[] };

/**
 * Load the church directory. New account numbers are added; an existing number
 * with a different name gets the new name. Rows without both are listed as skipped.
 */
export async function importDirectory(db: DbLike, actor: Actor, rows: DirectoryRow[]): Promise<DirectoryImportResult> {
  assertCan(actor, "manageMembers");
  const result: DirectoryImportResult = { added: 0, updated: 0, unchanged: 0, skipped: [] };
  const seen = new Map<string, string>();
  rows.forEach((r, i) => {
    const acct = normalizeAccount(r.accountNumber);
    const name = String(r.name ?? "").trim();
    if (!acct || !name) {
      if (acct || name) result.skipped.push(`Row ${i + 2}: needs both an account number and a name`);
      return;
    }
    if (acct.length > 30 || name.length > 100) return void result.skipped.push(`Row ${i + 2}: too long`);
    seen.set(acct, name);
  });
  await db.transaction(async (tx) => {
    const existing = new Map((await tx.select(cols).from(members)).map((m) => [m.accountNumber, m]));
    for (const [accountNumber, name] of seen) {
      const old = existing.get(accountNumber);
      if (!old) {
        await tx.insert(members).values({ accountNumber, name });
        result.added++;
      } else if (old.name !== name) {
        await tx.update(members).set({ name }).where(eq(members.id, old.id));
        result.updated++;
      } else result.unchanged++;
    }
    await writeAudit(tx, actor, { action: "person.import", table: "members", after: { ...result } });
  });
  return result;
}

export async function listAllPeopleForCheckout(db: DbLike): Promise<DirectoryRow[]> {
  return db.select({ accountNumber: members.accountNumber, name: members.name }).from(members).orderBy(asc(members.name));
}
