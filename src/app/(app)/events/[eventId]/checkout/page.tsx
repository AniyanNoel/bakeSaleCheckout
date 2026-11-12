import { getDb } from "@/db";
import { requirePermission } from "@/lib/auth";
import { loadEvent } from "@/lib/load";
import { can } from "@/lib/permissions";
import { loadCatalog } from "@/lib/services/catalog";
import { Checkout } from "./checkout";

export const metadata = { title: "Checkout" };

export default async function CheckoutPage({ params }: PageProps<"/events/[eventId]/checkout">) {
  const { eventId } = await params;
  const actor = await requirePermission("checkout");
  const ev = await loadEvent(eventId);
  const catalog = (await loadCatalog(getDb(), actor, ev.id))!;
  return <Checkout initial={catalog} isAdmin={can(actor.role, "miscLine")} userName={actor.name} />;
}
