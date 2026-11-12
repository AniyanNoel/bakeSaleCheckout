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
  setEventStatusAction,
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
  const editable = admin && ev.status !== "closed";
  const draft = ev.status === "draft";

  const active = items.filter((i) => i.active);
  const noPrice = active.filter((i) => i.unitPriceCents === null);
  const zeroPrice = active.filter((i) => i.unitPriceCents === 0);
  const noStation = active.filter((i) => i.stationId === null);
  const needsLook = active.filter((i) => itemWarnings(i).length > 0);
  const unknownSignups = items.reduce((n, i) => n + i.unknownSignupQty, 0);
  const base = `/events/${ev.id}`;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Items" value={items.length} sub={`${active.length} active`} />
          <Stat label="Stations" value={stations.length} />
          <Stat label="Volunteer signups" value={items.reduce((n, i) => n + i.signupCount, 0)} />
          <Stat label="Need a look" value={needsLook.length} tone={needsLook.length ? "amber" : undefined} />
        </div>

        {(noPrice.length > 0 || zeroPrice.length > 0 || noStation.length > 0 || unknownSignups > 0) && (
          <Notice>
            <p className="font-semibold">Before the sale</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {noPrice.length > 0 && (
                <li>
                  {noPrice.length} active item{noPrice.length > 1 ? "s have" : " has"} no price: {noPrice.map((i) => i.name).join(", ")}.
                </li>
              )}
              {zeroPrice.length > 0 && <li>Priced at $0: {zeroPrice.map((i) => i.name).join(", ")}. Is that right?</li>}
              {noStation.length > 0 && <li>{noStation.length} active items have no station yet.</li>}
              {unknownSignups > 0 && <li>{unknownSignups} volunteer signups have no quantity.</li>}
            </ul>
            <p className="mt-2">
              <TextLink href={`${base}/items`}>Go to items</TextLink>
            </p>
          </Notice>
        )}

        <Card title="Stations">
          <p className="mb-4 text-sm text-stone-600">
            Each station has a code letter. New items at a station get codes like A01, A02.
            {draft ? " Letters can change until the sale opens." : " Letters are locked now that the sale is open."}
          </p>
          {stations.length === 0 && <p className="mb-4 text-sm text-stone-500">No stations yet.</p>}
          <div className="space-y-2">
            {stations.map((s) => (
              <div key={s.id} className="flex flex-wrap items-start gap-2">
                <ActionForm action={updateStationAction.bind(null, s.id)} className="flex flex-1 flex-wrap items-start gap-2" showSuccess={false}>
                  <Input name="codePrefix" defaultValue={s.codePrefix} className="w-16 text-center font-mono uppercase" maxLength={2} disabled={!editable || !draft} aria-label="Code letter" />
                  <Input name="name" defaultValue={s.name} className="min-w-40 flex-1" disabled={!editable} aria-label="Station name" />
                  {editable && <SubmitButton variant="secondary">Save</SubmitButton>}
                </ActionForm>
                {editable && draft && (
                  <ActionForm action={deleteStationAction.bind(null, s.id)} confirm={`Remove ${s.name}? Its items will have no station.`}>
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
              <Input name="name" placeholder="New station name, e.g. Sweets table" className="min-w-40 flex-1" required aria-label="Station name" />
              <SubmitButton variant="secondary" pendingText="Adding…">
                Add station
              </SubmitButton>
            </ActionForm>
          )}
        </Card>
      </div>

      <div className="space-y-6">
        {admin && (
          <Card title="Sale status">
            {ev.status === "draft" && (
              <>
                <p className="text-sm text-stone-600">
                  Draft: set up items, codes and signups. Opening the sale locks item codes so printed slips and price sheets stay
                  correct. Prices can still be changed.
                </p>
                <ActionForm action={setEventStatusAction.bind(null, ev.id, "open")} className="mt-4" confirm="Open the sale? Item codes will be locked for this event.">
                  <SubmitButton pendingText="Opening…">Open the sale</SubmitButton>
                </ActionForm>
              </>
            )}
            {ev.status === "open" && (
              <>
                <p className="text-sm text-stone-600">The sale is open. Codes are locked. Close the event when the sale and follow-up are done.</p>
                <ActionForm action={setEventStatusAction.bind(null, ev.id, "closed")} className="mt-4" confirm="Close this event? It becomes read-only until reopened.">
                  <SubmitButton variant="secondary" pendingText="Closing…">
                    Close event
                  </SubmitButton>
                </ActionForm>
              </>
            )}
            {ev.status === "closed" && (
              <>
                <p className="text-sm text-stone-600">Closed and read-only. Reopen it only if something needs correcting.</p>
                <ActionForm action={setEventStatusAction.bind(null, ev.id, "open")} className="mt-4" confirm="Reopen this event?">
                  <SubmitButton variant="secondary" pendingText="Reopening…">
                    Reopen event
                  </SubmitButton>
                </ActionForm>
              </>
            )}
          </Card>
        )}

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
