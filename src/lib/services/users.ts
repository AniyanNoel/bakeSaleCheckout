import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, count, eq, gt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbLike } from "@/db";
import { sessions, users, type Role, type User } from "@/db/schema";
import { LOCKOUT_MINUTES, MAX_FAILED_LOGINS, SESSION_HOURS } from "../constants";
import { UserError, isUniqueViolation } from "../errors";
import { assertCan, type Actor } from "../permissions";
import { parseInput } from "../validate";
import { writeAudit } from "./audit";

const BCRYPT_COST = 12;
export const MIN_PASSWORD_LENGTH = 10;

const roleSchema = z.enum(["admin", "cashier", "volunteer"]);
const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(200);
const newUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(100),
  email: z.string().trim().toLowerCase().email("That email address doesn't look right."),
  role: roleSchema,
  password: passwordSchema,
});


export function toActor(u: Pick<User, "id" | "role" | "name">): Actor {
  return { id: u.id, role: u.role, name: u.name };
}

export async function countUsers(db: DbLike): Promise<number> {
  const [r] = await db.select({ n: count() }).from(users);
  return r.n;
}

/** First-run setup: creates the first admin, and only if there are no users at all. */
export async function createFirstAdmin(db: DbLike, input: unknown): Promise<User> {
  const data = parseInput(newUserSchema.omit({ role: true }), input);
  return db.transaction(async (tx) => {
    // Serialise concurrent setup attempts so only one can ever win.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(72710001)`);
    if ((await countUsers(tx)) > 0) throw new UserError("Setup is already done. Please sign in.");
    const [u] = await tx
      .insert(users)
      .values({ name: data.name, email: data.email, role: "admin", passwordHash: await bcrypt.hash(data.password, BCRYPT_COST) })
      .returning();
    await writeAudit(tx, toActor(u), { action: "user.create_first_admin", table: "users", rowId: u.id, after: u });
    return u;
  });
}

export async function createUser(db: DbLike, actor: Actor, input: unknown): Promise<User> {
  assertCan(actor, "manageUsers");
  const data = parseInput(newUserSchema, input);
  try {
    return await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({ name: data.name, email: data.email, role: data.role, passwordHash: await bcrypt.hash(data.password, BCRYPT_COST) })
        .returning();
      await writeAudit(tx, actor, { action: "user.create", table: "users", rowId: u.id, after: u });
      return u;
    });
  } catch (err) {
    if (isUniqueViolation(err, "users_email_key")) throw new UserError("Someone already has an account with that email.");
    throw err;
  }
}

async function activeAdminCount(tx: DbLike, excludingId: number): Promise<number> {
  const [r] = await tx
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.active, true), ne(users.id, excludingId)));
  return r.n;
}

export async function updateUser(
  db: DbLike,
  actor: Actor,
  userId: number,
  input: { name?: string; role?: Role; active?: boolean },
): Promise<User> {
  assertCan(actor, "manageUsers");
  const data = parseInput(
    z.object({ name: z.string().trim().min(1).max(100).optional(), role: roleSchema.optional(), active: z.boolean().optional() }),
    input,
  );
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(72710002)`);
    const [before] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!before) throw new UserError("That account no longer exists.");
    const losesAdmin = before.role === "admin" && before.active && (data.role && data.role !== "admin" || data.active === false);
    if (losesAdmin && (await activeAdminCount(tx, userId)) === 0) {
      throw new UserError("There must always be at least one active admin.");
    }
    const [after] = await tx.update(users).set(data).where(eq(users.id, userId)).returning();
    if (data.active === false || (data.role && data.role !== before.role)) {
      // Role or access changed: sign them out everywhere so it takes effect now.
      await tx.delete(sessions).where(eq(sessions.userId, userId));
    }
    await writeAudit(tx, actor, { action: "user.update", table: "users", rowId: userId, before, after });
    return after;
  });
}

export async function resetPassword(db: DbLike, actor: Actor, userId: number, password: string): Promise<void> {
  if (actor.id !== userId) assertCan(actor, "manageUsers");
  const pw = parseInput(passwordSchema, password);
  await db.transaction(async (tx) => {
    const hash = await bcrypt.hash(pw, BCRYPT_COST);
    const [u] = await tx
      .update(users)
      .set({ passwordHash: hash, failedLogins: 0, lockedUntil: null })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    if (!u) throw new UserError("That account no longer exists.");
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await writeAudit(tx, actor, { action: "user.reset_password", table: "users", rowId: userId });
  });
}

// ---------------------------------------------------------------------------
// Login and sessions
// ---------------------------------------------------------------------------

let dummyHash: string | undefined;
const GENERIC_LOGIN_ERROR = "That email and password don't match an active account.";

export async function verifyLogin(db: DbLike, emailRaw: string, password: string, now = new Date()): Promise<User> {
  const email = emailRaw.trim().toLowerCase();
  const [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u || !u.active) {
    // Spend the same time as a real check so response timing doesn't reveal which emails exist.
    dummyHash ??= await bcrypt.hash("not-a-real-password", BCRYPT_COST);
    await bcrypt.compare(password, dummyHash);
    throw new UserError(GENERIC_LOGIN_ERROR);
  }
  if (u.lockedUntil && u.lockedUntil > now) {
    throw new UserError(`Too many wrong passwords. Try again in ${LOCKOUT_MINUTES} minutes, or ask an admin to reset it.`);
  }
  if (!(await bcrypt.compare(password, u.passwordHash))) {
    const failed = u.failedLogins + 1;
    await db
      .update(users)
      .set(
        failed >= MAX_FAILED_LOGINS
          ? { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) }
          : { failedLogins: failed },
      )
      .where(eq(users.id, u.id));
    throw new UserError(GENERIC_LOGIN_ERROR);
  }
  if (u.failedLogins || u.lockedUntil) {
    await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, u.id));
  }
  return u;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(db: DbLike, userId: number, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3600_000);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function findSessionUser(db: DbLike, token: string, now = new Date()): Promise<User | null> {
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, now), eq(users.active, true)));
  return rows[0]?.user ?? null;
}

export async function deleteSession(db: DbLike, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export async function listUsers(db: DbLike, actor: Actor) {
  assertCan(actor, "manageUsers");
  return db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active, createdAt: users.createdAt })
    .from(users)
    .orderBy(users.name);
}

/** Change your own password, after confirming the current one. */
export async function changeOwnPassword(db: DbLike, actor: Actor, current: string, next: string): Promise<void> {
  const [u] = await db.select().from(users).where(eq(users.id, actor.id));
  if (!u || !(await bcrypt.compare(current, u.passwordHash))) throw new UserError("Your current password isn't right.");
  await resetPassword(db, actor, actor.id, next);
}
