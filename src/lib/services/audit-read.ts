import { desc, eq, lt, and } from "drizzle-orm";
import type { DbLike } from "@/db";
import { auditLog, users } from "@/db/schema";
import { assertCan, type Actor } from "../permissions";

export async function listAudit(db: DbLike, actor: Actor, opts: { eventId?: number; beforeId?: number; limit?: number } = {}) {
  assertCan(actor, "viewAudit");
  const conds = [];
  if (opts.eventId) conds.push(eq(auditLog.eventId, opts.eventId));
  if (opts.beforeId) conds.push(lt(auditLog.id, opts.beforeId));
  return db
    .select({ entry: auditLog, userName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLog.id))
    .limit(opts.limit ?? 100);
}
