import Link from "next/link";
import { getDb } from "@/db";
import type { Station } from "@/db/schema";
import { requirePermission } from "@/lib/auth";
import { loadEvent } from "@/lib/load";
import { formatCents } from "@/lib/money";
import { itemWarnings, listItems, type ItemRow } from "@/lib/services/items";
import { listStations } from "@/lib/services/stations";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ItemFields } from "@/components/item-fields";
import { Badge, Card, Input, Table, Td, Th, TextLink } from "@/components/ui";
import { createItemAction, createStationAction, renumberCodesAction } from "../../actions";

export const metadata = { title: "Items" };

export default async function ItemsPage({ params }: PageProps<"/events/[eventId]/items">) {
  const { eventId } = await params;
  await requirePermission("manageItems");
  const ev = await loadEvent(eventId);
  const db = getDb();
  const [items, stations] = await Promise.all([listItems(db, ev.id), listStations(db, ev.id)]);
  const base = `/events/${ev.id}`;
  const groups: { station: Station | null; items: ItemRow[] }[] = stations.map((s) => ({ station: s, items: items.filter((i) => i.stationId === s.id) }));
  const loose = items.filter((i) => i.stationId === null);
  if (loose.length) groups.push({ station: null, items: loose });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        {groups.length === 0 && (
          <Card>
            <p className="text-sm text-stone-600">
              Start by adding a table on the right (for example &quot;Indian food&quot;), then add its items. Or{" "}
              <TextLink href={`${base}/import`}>import last year&apos;s sheet</TextLink>.
            </p>
          </Card>
        )}
        {groups.map((g) => (
          <section key={g.station?.id ?? "none"}>
            <h2 className="mb-2 flex items-baseline gap-2 text-lg font-semibold">
              {g.station ? (
                <>
                  <span className="rounded bg-amber-100 px-2 font-mono text-amber-900">{g.station.codePrefix}</span> {g.station.name}
                </>
              ) : (
                <span className="text-stone-500">No table yet</span>
              )}
              <span className="text-sm font-normal text-stone-500">{g.items.length} items</span>
            </h2>
            {g.items.length === 0 ? (
              <p className="rounded-lg border border-dashed border-stone-300 p-4 text-sm text-stone-500">No items at this table yet. Add one on the right.</p>
            ) : (
              <Table>
                <thead className="bg-stone-50">
                  <tr>
                    <Th className="w-20">Code</Th>
                    <Th>Item</Th>
                    <Th className="text-right">Price</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {g.items.map((it) => {
                    const warnings = it.active ? itemWarnings(it).filter((w) => w !== "No station") : [];
                    return (
                      <tr key={it.id} className={it.active ? "" : "bg-stone-50 text-stone-400"}>
                        <Td className="font-mono font-semibold">{it.code}</Td>
                        <Td>
                          <Link href={`${base}/items/${it.id}`} className="font-medium hover:text-amber-800 hover:underline">
                            {it.name}
                          </Link>
                          <span className="ml-2 inline-flex gap-1">
                            {!it.active && <Badge>Hidden</Badge>}
                            {warnings.map((w) => (
                              <Badge key={w} tone="amber">
                                {w}
                              </Badge>
                            ))}
                          </span>
                        </Td>
                        <Td className="text-right tabular-nums">{formatCents(it.unitPriceCents)}</Td>
                        <Td className="text-right">
                          <Link href={`${base}/items/${it.id}`} className="text-sm text-amber-800 hover:underline">
                            Edit
                          </Link>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </section>
        ))}
      </div>

      <div className="space-y-6">
        <Card title="Add an item">
          <ActionForm key={stations.length} action={createItemAction.bind(null, ev.id)} resetOnSuccess className="space-y-4">
            <ItemFields stations={stations} defaultStationId={stations[0]?.id} />
            <SubmitButton pendingText="Adding…">Add item</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Add a table">
          <ActionForm action={createStationAction.bind(null, ev.id)} resetOnSuccess className="space-y-3">
            <div className="flex gap-2">
              <div className="w-20 shrink-0">
                <Input name="codePrefix" placeholder="A" className="text-center font-mono uppercase" maxLength={2} aria-label="Code letter" />
              </div>
              <Input name="name" placeholder="e.g. Indian food" required aria-label="Table name" />
            </div>
            <p className="text-xs text-stone-500">Leave the letter blank to use the next one (A, B, C…). Rename or remove tables under Settings.</p>
            <SubmitButton variant="secondary" pendingText="Adding…">
              Add table
            </SubmitButton>
          </ActionForm>
        </Card>
        {items.length > 0 && (
          <Card title="Tidy up codes">
            <p className="mb-3 text-sm text-stone-600">Number every table&apos;s items again from 1 (A01, A02, B01…). Do this before printing the code sheet.</p>
            <ActionForm action={renumberCodesAction.bind(null, ev.id)} confirm="Renumber every item code by table? Reprint the code sheet afterwards.">
              <SubmitButton variant="secondary" pendingText="Renumbering…">
                Renumber codes
              </SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </div>
  );
}
