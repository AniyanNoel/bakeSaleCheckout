import { eq } from "drizzle-orm";
import type { DbLike } from "@/db";
import { events } from "@/db/schema";
import { assertCan, type Actor } from "../permissions";
import { listItems } from "./items";
import { listAllPeopleForCheckout, type DirectoryRow } from "./members";

export type CatalogItem = {
  id: number;
  code: string;
  name: string;
  priceCents: number | null;
  station: string | null;
  stationPrefix: string | null;
  active: boolean;
};

export type Catalog = {
  event: { id: number; name: string };
  items: CatalogItem[];
  people: DirectoryRow[];
  loadedAt: string;
};

/** Everything the checkout screen needs, so it keeps working if the Wi-Fi drops. */
export async function loadCatalog(db: DbLike, actor: Actor, eventId: number): Promise<Catalog | null> {
  assertCan(actor, "checkout");
  const [ev] = await db.select().from(events).where(eq(events.id, eventId));
  if (!ev) return null;
  const [items, people] = await Promise.all([listItems(db, eventId), listAllPeopleForCheckout(db)]);
  return {
    event: { id: ev.id, name: ev.name },
    items: items.map((i) => ({
      id: i.id,
      code: i.code,
      name: i.name,
      priceCents: i.unitPriceCents,
      station: i.station?.name ?? null,
      stationPrefix: i.station?.codePrefix ?? null,
      active: i.active,
    })),
    people,
    loadedAt: new Date().toISOString(),
  };
}
