import Link from "next/link";
import { getDb } from "@/db";
import { requirePermission } from "@/lib/auth";
import { loadEvent } from "@/lib/load";
import { formatCents } from "@/lib/money";
import { can } from "@/lib/permissions";
import { codesAreLocked } from "@/lib/services/events";
import { itemWarnings, listItems } from "@/lib/services/items";
import { listStations } from "@/lib/services/stations";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ItemFields } from "@/components/item-fields";
import { Badge, Card, Table, Td, Th, TextLink } from "@/components/ui";
import { createItemAction, renumberCodesAction } from "../../actions";

export const metadata = { title: "Items" };

export default async function ItemsPage({ params }: PageProps<"/events/[eventId]/items">) {
  const { eventId } = await params;
  const actor = await requirePermission("viewItems");
  const ev = await loadEvent(eventId);
  const db = getDb();
  const [items, stations] = await Promise.all([listItems(db, ev.id), listStations(db, ev.id)]);
  const admin = can(actor.role, "manageItems") && ev.status !== "closed";
  const locked = codesAreLocked(ev);
  const base = `/events/${ev.id}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-600">
          {items.length} items. Committed is the total volunteers signed up for.
          {locked ? " Codes are locked while the sale is open." : " Codes can still change until the sale opens."}
        </p>
        {admin && !locked && items.length > 0 && (
          <ActionForm action={renumberCodesAction.bind(null, ev.id)} confirm="Give every item a fresh code from its station letter (A01, A02, B01...)? Do this before printing slips.">
            <SubmitButton variant="secondary" pendingText="Renumbering…">
              Renumber codes by station
            </SubmitButton>
          </ActionForm>
        )}
      </div>

      {items.length === 0 ? (
        <Card>
          <p className="text-sm text-stone-600">
            No items yet.{" "}
            {admin && (
              <>
                <TextLink href={`${base}/import`}>Import last year&apos;s sheet</TextLink> or add them below.
              </>
            )}
          </p>
        </Card>
      ) : (
        <Table>
          <thead className="bg-stone-50">
            <tr>
              <Th>Code</Th>
              <Th>Item</Th>
              <Th>Station</Th>
              <Th>Unit</Th>
              <Th className="text-right">Price</Th>
              <Th className="text-right">Expected</Th>
              <Th className="text-right">Committed</Th>
              <Th className="text-right">Available</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {items.map((it) => {
              const warnings = it.active ? itemWarnings(it) : [];
              return (
                <tr key={it.id} className={it.active ? "" : "bg-stone-50 text-stone-400"}>
                  <Td className="font-mono font-semibold">{it.code}</Td>
                  <Td>
                    {admin ? (
                      <Link href={`${base}/items/${it.id}`} className="font-medium text-stone-900 hover:text-amber-800 hover:underline">
                        {it.name}
                      </Link>
                    ) : (
                      it.name
                    )}
                    {it.category && <div className="text-xs text-stone-500">{it.category}</div>}
                  </Td>
                  <Td>{it.station?.name ?? <span className="text-stone-400">—</span>}</Td>
                  <Td>{it.unit}</Td>
                  <Td className="text-right tabular-nums">{formatCents(it.unitPriceCents)}</Td>
                  <Td className="text-right tabular-nums">{it.expectedQty ?? "—"}</Td>
                  <Td className="text-right tabular-nums">
                    {it.committedQty}
                    {it.unknownSignupQty > 0 && <span className="text-amber-700"> +?</span>}
                    {it.signupCount > 0 && <div className="text-xs text-stone-500">{it.signupCount} signup{it.signupCount > 1 ? "s" : ""}</div>}
                  </Td>
                  <Td className="text-right tabular-nums">{it.availableQty ?? "—"}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {!it.active && <Badge>Inactive</Badge>}
                      {warnings.map((w) => (
                        <Badge key={w} tone="amber">
                          {w}
                        </Badge>
                      ))}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {admin && (
        <Card title="Add an item">
          <ActionForm action={createItemAction.bind(null, ev.id)} resetOnSuccess className="space-y-4">
            <ItemFields stations={stations} codeLocked={false} />
            <SubmitButton pendingText="Adding…">Add item</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
