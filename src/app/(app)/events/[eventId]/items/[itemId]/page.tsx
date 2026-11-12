import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requirePermission } from "@/lib/auth";
import { loadEvent } from "@/lib/load";
import { codesAreLocked } from "@/lib/services/events";
import { getItem } from "@/lib/services/items";
import { listStations } from "@/lib/services/stations";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ItemFields } from "@/components/item-fields";
import { Card, Notice, TextLink } from "@/components/ui";
import { deleteItemAction, setItemActiveAction, updateItemAction } from "../../../actions";

export const metadata = { title: "Edit item" };

export default async function EditItemPage({ params }: PageProps<"/events/[eventId]/items/[itemId]">) {
  const { eventId, itemId } = await params;
  await requirePermission("manageItems");
  const ev = await loadEvent(eventId);
  const db = getDb();
  const item = await getItem(db, Number(itemId));
  if (!item || item.eventId !== ev.id) notFound();
  const stations = await listStations(db, ev.id);
  const locked = codesAreLocked(ev);
  const closed = ev.status === "closed";
  const base = `/events/${ev.id}`;

  return (
    <div className="max-w-3xl space-y-6">
      <TextLink href={`${base}/items`}>← Back to items</TextLink>
      {item.importNote && (
        <Notice>
          <span className="font-semibold">From the import: </span>
          {item.importNote}
        </Notice>
      )}
      <Card title={`${item.code} · ${item.name}`}>
        <ActionForm action={updateItemAction.bind(null, item.id)} className="space-y-4">
          <ItemFields item={item} stations={stations} codeLocked={locked} disabled={closed} />
          {!locked && (
            <p className="text-xs text-stone-500">
              Moving an item to another station keeps its code. Use &quot;Renumber codes by station&quot; on the items page to tidy codes before printing.
            </p>
          )}
          {!closed && <SubmitButton>Save changes</SubmitButton>}
        </ActionForm>
      </Card>

      {!closed && (
        <Card title={locked ? "Stop selling this item" : "Remove this item"}>
          {locked ? (
            <>
              <p className="mb-3 text-sm text-stone-600">Once the sale is open, items can&apos;t be deleted. Mark it inactive so checkout stops offering it.</p>
              <ActionForm action={setItemActiveAction.bind(null, item.id, !item.active)}>
                <SubmitButton variant="secondary">{item.active ? "Mark inactive" : "Make active again"}</SubmitButton>
              </ActionForm>
            </>
          ) : (
            <>
              <p className="mb-3 text-sm text-stone-600">The sale hasn&apos;t opened, so the item and its volunteer signups can be removed. This is recorded in the audit log.</p>
              <ActionForm action={deleteItemAction.bind(null, item.id, ev.id)} confirm={`Remove ${item.name} and its signups?`}>
                <SubmitButton variant="danger" pendingText="Removing…">
                  Remove item
                </SubmitButton>
              </ActionForm>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
