import { auditLog } from "@/db/schema";
import type { DbLike } from "@/db";
import type { Actor } from "../permissions";

type AuditEntry = {
  action: string;
  table: string;
  rowId?: string | number | null;
  eventId?: number | null;
  before?: unknown;
  after?: unknown;
};

/** Never record secrets in the audit trail. */
function scrub(value: unknown): unknown {
  if (!value || typeof value !== "object") return value ?? null;
  const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  delete copy.passwordHash;
  return copy;
}

/**
 * Write an audit row. Always call this with the same transaction as the change
 * it describes, so the change and its record succeed or fail together.
 */
export async function writeAudit(tx: DbLike, actor: Actor | null, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    userId: actor?.id ?? null,
    action: entry.action,
    tableName: entry.table,
    rowId: entry.rowId == null ? null : String(entry.rowId),
    eventId: entry.eventId ?? null,
    before: scrub(entry.before) as object | null,
    after: scrub(entry.after) as object | null,
  });
}
