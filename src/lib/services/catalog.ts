import { eq } from "drizzle-orm";
import type { DbLike } from "@/db";
import { events } from "@/db/schema";
import { assertCan, type Actor } from "../permissions";
import { listItems } from "./items";
import { listMemberSummaries, type MemberSummary } from "./members";

export type CatalogItem = {
  id: number;
  code: string;
  name: string;
  unit: string;
  priceCents: number | null;
  station: string | null;
  stationPrefix: string | null;
  active: boolean;
  availableQty: number | null;
};

export type Catalog = {
  event: { id: number; name: string; status: string };
  items: CatalogItem[];
  members: MemberSummary[];
  loadedAt: string;
};

/** Everything the checkout screen needs to keep working offline. */
export async function loadCatalog(db: DbLike, actor: Actor, eventId: number): Promise<Catalog | null> {
  assertCan(actor, "checkout");
  const [ev] = await db.select().from(events).where(eq(events.id, eventId));
  if (!ev) return null;
  const [items, members] = await Promise.all([listItems(db, eventId), listMemberSummaries(db, actor)]);
  return {
    event: { id: ev.id, name: ev.name, status: ev.status },
    items: items.map((i) => ({
      id: i.id,
      code: i.code,
      name: i.name,
      unit: i.unit,
      priceCents: i.unitPriceCents,
      station: i.station?.name ?? null,
      stationPrefix: i.station?.codePrefix ?? null,
      active: i.active,
      availableQty: i.availableQty,
    })),
    members,
    loadedAt: new Date().toISOString(),
  };
}
