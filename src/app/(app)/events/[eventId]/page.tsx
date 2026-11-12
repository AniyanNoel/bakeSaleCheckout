import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { loadEvent } from "@/lib/load";
import { can } from "@/lib/permissions";
import { itemWarnings, listItems } from "@/lib/services/items";
import { listStations } from "@/lib/services/stations";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Field, Input, Notice, TextLink } from "@/components/ui";
import {
  createStationAction,
  deleteStationAction,
  updateEventAction,
  updateStationAction,
} from "../actions";

export default async function EventOverviewPage({ params }: PageProps<"/events/[eventId]">) {
  const { eventId } = await params;
  const actor = await requireUser();
  const ev = await loadEvent(eventId);
  const db = getDb();
  const [items, stations] = await Promise.all([listItems(db, ev.id), listStations(db, ev.id)]);
  const admin = can(actor.role, "manageEvents");
  const editable = admin;
  const draft = true;

  const active = items.filter((i) => i.active);
  const noPrice = active.filter((i) => i.unitPriceCents === null);
  const zeroPrice = active.filter((i) => i.unitPriceCents === 0);
  const noStation = active.filter((i) => i.stationId === null);
  const needsLook = active.filter((i) => itemWarnings(i).length > 0);
  const base = `/events/${ev.id}`;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
      <div className="space-y-6">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Items" value={items.length} sub={`${active.length} active`} />
          <Stat label="Tables" value={stations.length} />
          <Stat label="Need a look" value={needsLook.length} tone={needsLook.length ? "amber" : undefined} />
        </div>

        {(noPrice.length > 0 || zeroPrice.length > 0 || noStation.length > 0) && (
          <Notice>
            <p className="font-semibold">Before the sale</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {noPrice.length > 0 && (
                <li>
                  {noPrice.length} active item{noPrice.length > 1 ? "s have" : " has"} no price: {noPrice.map((i) => i.name).join(", ")}.
                </li>
              )}
              {zeroPrice.length > 0 && <li>Priced at $0: {zeroPrice.map((i) => i.name).join(", ")}. Is that right?</li>}
              {noStation.length > 0 && <li>{noStation.length} active items have no table yet.</li>}
            </ul>
            <p className="mt-2">
              <TextLink href={`${base}/items`}>Go to items</TextLink>
            </p>
          </Notice>
        )}

        <Card title="Tables">
          <p className="mb-4 text-sm text-stone-600">
            Each food table has a letter, and its items get codes from it: the Indian food table could be A, with A01 Kappa and fish, A02 Poori
            and chicken. Add as many items to a table as you like on the Items page.
          </p>
          {stations.length === 0 && <p className="mb-4 text-sm text-stone-500">No tables yet.</p>}
          <div className="space-y-2">
            {stations.map((s) => (
              <div key={s.id} className="flex flex-wrap items-start gap-2">
                <ActionForm action={updateStationAction.bind(null, s.id)} className="flex flex-1 flex-wrap items-start gap-2" showSuccess={false}>
                  <Input name="codePrefix" defaultValue={s.codePrefix} className="w-16 text-center font-mono uppercase" maxLength={2} disabled={!editable || !draft} aria-label="Code letter" />
                  <Input name="name" defaultValue={s.name} className="min-w-40 flex-1" disabled={!editable} aria-label="Table name" />
                  {editable && <SubmitButton variant="secondary">Save</SubmitButton>}
                </ActionForm>
                {editable && draft && (
                  <ActionForm action={deleteStationAction.bind(null, s.id)} confirm={`Remove ${s.name}? Its items will have no table.`}>
                    <SubmitButton variant="danger" pendingText="Removing…">
                      Remove
                    </SubmitButton>
                  </ActionForm>
                )}
              </div>
            ))}
          </div>
          {editable && (
            <ActionForm action={createStationAction.bind(null, ev.id)} resetOnSuccess className="mt-4 flex flex-wrap items-start gap-2 border-t border-stone-100 pt-4">
              <Input name="codePrefix" placeholder="Auto" className="w-16 text-center font-mono uppercase" maxLength={2} aria-label="Code letter" />
              <Input name="name" placeholder="New table, e.g. Indian food" className="min-w-40 flex-1" required aria-label="Table name" />
              <SubmitButton variant="secondary" pendingText="Adding…">
                Add table
              </SubmitButton>
            </ActionForm>
          )}
        </Card>
      </div>

      <div className="space-y-6">
        {admin && (
          <Card title="Event details">
            <ActionForm action={updateEventAction.bind(null, ev.id)} className="space-y-4">
              <Field label="Name">
                <Input name="name" defaultValue={ev.name} required disabled={!editable} />
              </Field>
              <Field label="Sale date" hint="Leave blank until it's decided.">
                <Input name="saleDate" type="date" defaultValue={ev.saleDate ?? ""} disabled={!editable} />
              </Field>
              <Field label="Notes">
                <textarea name="notes" defaultValue={ev.notes ?? ""} rows={3} disabled={!editable} className="block w-full rounded-md border border-stone-300 px-3 py-2 text-sm shadow-sm disabled:bg-stone-100" />
              </Field>
              {editable && <SubmitButton>Save details</SubmitButton>}
            </ActionForm>
          </Card>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: "amber" }) {
  return (
    <div className={`rounded-lg border bg-white p-4 shadow-sm ${tone === "amber" ? "border-amber-300" : "border-stone-200"}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-stone-500">{sub}</div>}
    </div>
  );
}
