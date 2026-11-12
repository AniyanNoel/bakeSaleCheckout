import { and, eq } from "drizzle-orm";
import type { DbLike } from "@/db";
import { items, signups, stations } from "@/db/schema";
import { nextCode, UNASSIGNED_PREFIX } from "../codes";
import { UserError } from "../errors";
import { normalizeName, pickQuantity, type ImportPreview, type QuantityChoice } from "../import/parse";
import { assertCan, type Actor } from "../permissions";
import { writeAudit } from "./audit";
import { lockEditableEvent } from "./events";
import { findOrCreateVolunteer } from "./signups";

export type ImportOptions = {
  quantity: QuantityChoice;
  /** Station to put every imported item in, or null for "no station yet". */
  stationId: number | null;
  /** Item keys (normalised names) the admin unticked in the preview. */
  skipKeys?: string[];
  importVolunteers: boolean;
};

export type ImportResult = {
  created: { code: string; name: string }[];
  skippedExisting: string[];
  signupsCreated: number;
};

/**
 * Save a reviewed import. Re-run safe: items whose name already exists in the
 * event are skipped, so importing the same file twice doesn't double up.
 */
export async function applyImport(
  db: DbLike,
  actor: Actor,
  eventId: number,
  preview: ImportPreview,
  options: ImportOptions,
): Promise<ImportResult> {
  assertCan(actor, "manageItems");
  if (preview.hasQuantityConflicts && options.quantity.kind === "source" && !preview.quantitySources.includes(options.quantity.source)) {
    throw new UserError("Pick which quantity column to use.");
  }
  return db.transaction(async (tx) => {
    await lockEditableEvent(tx, eventId);
    let prefix = UNASSIGNED_PREFIX;
    if (options.stationId !== null) {
      const [s] = await tx.select().from(stations).where(and(eq(stations.id, options.stationId), eq(stations.eventId, eventId)));
      if (!s) throw new UserError("That station isn't part of this event.");
      prefix = s.codePrefix;
    }
    const existing = await tx.select({ code: items.code, name: items.name }).from(items).where(eq(items.eventId, eventId));
    const codes = existing.map((e) => e.code);
    const existingNames = new Set(existing.map((e) => normalizeName(e.name)));
    const skip = new Set(options.skipKeys ?? []);

    const result: ImportResult = { created: [], skippedExisting: [], signupsCreated: 0 };
    for (const row of preview.items) {
      if (skip.has(row.key)) continue;
      if (existingNames.has(row.key)) {
        result.skippedExisting.push(row.name);
        continue;
      }
      const code = nextCode(prefix, codes);
      codes.push(code);
      existingNames.add(row.key);
      const [it] = await tx
        .insert(items)
        .values({
          eventId,
          code,
          name: row.name,
          unitPriceCents: row.priceCents,
          expectedQty: pickQuantity(row, options.quantity),
          stationId: options.stationId,
          importNote: row.warnings.length ? row.warnings.join(" ") : null,
        })
        .returning();
      result.created.push({ code, name: row.name });
      await writeAudit(tx, actor, { action: "item.import", table: "items", rowId: it.id, eventId, after: it });

      if (options.importVolunteers) {
        for (const v of row.volunteers) {
          const vol = await findOrCreateVolunteer(tx, v.name);
          const [s] = await tx
            .insert(signups)
            .values({ itemId: it.id, volunteerId: vol.id, committedQty: v.qty, note: v.qty === null ? `Imported as "${v.raw}"` : null })
            .returning();
          result.signupsCreated++;
          await writeAudit(tx, actor, { action: "signup.import", table: "signups", rowId: s.id, eventId, after: s });
        }
      }
    }
    await writeAudit(tx, actor, {
      action: "event.import_summary",
      table: "events",
      rowId: eventId,
      eventId,
      after: { options, created: result.created.length, skippedExisting: result.skippedExisting, signups: result.signupsCreated },
    });
    return result;
  });
}
