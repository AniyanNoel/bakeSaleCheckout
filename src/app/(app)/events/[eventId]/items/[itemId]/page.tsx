import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requirePermission } from "@/lib/auth";
import { loadEvent } from "@/lib/load";
import { getItem } from "@/lib/services/items";
import { listStations } from "@/lib/services/stations";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ItemFields } from "@/components/item-fields";
import { Card, Notice, TextLink } from "@/components/ui";
import { deleteItemAction, updateItemAction } from "../../../actions";

export const metadata = { title: "Edit item" };

export default async function EditItemPage({ params }: PageProps<"/events/[eventId]/items/[itemId]">) {
  const { eventId, itemId } = await params;
  await requirePermission("manageItems");
  const ev = await loadEvent(eventId);
  const db = getDb();
  const item = await getItem(db, Number(itemId));
  if (!item || item.eventId !== ev.id) notFound();
  const stations = await listStations(db, ev.id);
  const base = `/events/${ev.id}`;

  return (
    <div className="max-w-xl space-y-6">
      <TextLink href={`${base}/items`}>← Back to items</TextLink>
      {item.importNote && (
        <Notice>
          <span className="font-semibold">From the import: </span>
          {item.importNote}
        </Notice>
      )}
      <Card title={`${item.code} · ${item.name}`}>
        <ActionForm action={updateItemAction.bind(null, item.id)} className="space-y-4">
          <ItemFields item={item} stations={stations} />
          <p className="text-xs text-stone-500">Changing the price or code doesn&apos;t change checkouts already saved. Reprint the code sheet if codes change.</p>
          <SubmitButton>Save changes</SubmitButton>
        </ActionForm>
      </Card>
      <Card title="Delete this item">
        <p className="mb-3 text-sm text-stone-600">Checkouts that already include it keep it on their receipt.</p>
        <ActionForm action={deleteItemAction.bind(null, item.id, ev.id)} confirm={`Delete ${item.code} ${item.name}?`}>
          <SubmitButton variant="danger" pendingText="Deleting…">
            Delete item
          </SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
