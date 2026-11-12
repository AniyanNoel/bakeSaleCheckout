import { getDb } from "@/db";
import { requirePermission } from "@/lib/auth";
import { NORMAL_SIGNUP_MAX } from "@/lib/constants";
import { loadEvent } from "@/lib/load";
import { listItems } from "@/lib/services/items";
import { listSignupsForEvent, listVolunteerNames } from "@/lib/services/signups";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Input, TextLink } from "@/components/ui";
import { addSignupAction, removeSignupAction, updateSignupAction } from "../../actions";

export const metadata = { title: "Volunteer signups" };

export default async function SignupsPage({ params }: PageProps<"/events/[eventId]/signups">) {
  const { eventId } = await params;
  await requirePermission("manageSignups");
  const ev = await loadEvent(eventId);
  const db = getDb();
  const [items, signups, names] = await Promise.all([listItems(db, ev.id), listSignupsForEvent(db, ev.id), listVolunteerNames(db)]);
  const editable = ev.status !== "closed";
  const byItem = Map.groupBy(signups, (s) => s.itemId);

  if (!items.length) {
    return (
      <Card>
        <p className="text-sm text-stone-600">
          Add or <TextLink href={`/events/${ev.id}/import`}>import</TextLink> items first, then record who is bringing what.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">
        Any number of volunteers can sign up for the same item. Quantities from 1 to {NORMAL_SIGNUP_MAX} are normal; tick
        &quot;large&quot; for more. Typing a name that already exists links to the same volunteer.
      </p>
      <datalist id="volunteer-names">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {items.map((it) => {
        const rows = byItem.get(it.id) ?? [];
        const short = it.expectedQty !== null && it.committedQty < it.expectedQty;
        return (
          <section key={it.id} className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">
                <span className="mr-2 font-mono text-stone-500">{it.code}</span>
                {it.name}
                {!it.active && (
                  <span className="ml-2">
                    <Badge>Inactive</Badge>
                  </span>
                )}
              </h2>
              <div className="text-sm tabular-nums">
                <span className={short ? "text-amber-800" : "text-green-700"}>
                  {it.committedQty}
                  {it.unknownSignupQty > 0 && "+?"} committed
                </span>
                <span className="text-stone-500"> of {it.expectedQty ?? "?"} expected · {it.unit}</span>
              </div>
            </div>

            {rows.length > 0 && (
              <ul className="mt-3 divide-y divide-stone-100">
                {rows.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-start gap-2 py-2">
                    <span className="w-40 pt-2 text-sm font-medium">{s.volunteerName}</span>
                    <ActionForm action={updateSignupAction.bind(null, s.id)} className="flex flex-1 flex-wrap items-start gap-2" showSuccess={false}>
                      <Input name="qty" defaultValue={s.committedQty ?? ""} placeholder="?" inputMode="numeric" className={`w-20 ${s.committedQty === null ? "border-amber-400" : ""}`} disabled={!editable} aria-label="Quantity" required />
                      <Input name="note" defaultValue={s.note ?? ""} placeholder="Note" className="min-w-32 flex-1" disabled={!editable} aria-label="Note" />
                      <label className="flex items-center gap-1 pt-2 text-xs text-stone-600">
                        <input type="checkbox" name="allowLarge" defaultChecked={(s.committedQty ?? 0) > NORMAL_SIGNUP_MAX} disabled={!editable} />
                        large
                      </label>
                      {editable && <SubmitButton variant="small">Save</SubmitButton>}
                    </ActionForm>
                    {editable && (
                      <ActionForm action={removeSignupAction.bind(null, s.id)} confirm={`Remove ${s.volunteerName}'s signup for ${it.name}?`}>
                        <SubmitButton variant="small" pendingText="…">
                          Remove
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {editable && (
              <ActionForm action={addSignupAction.bind(null, it.id)} resetOnSuccess className="mt-3 flex flex-wrap items-start gap-2 border-t border-stone-100 pt-3">
                <Input name="volunteerName" list="volunteer-names" placeholder="Volunteer name" className="w-48" required aria-label="Volunteer name" />
                <Input name="qty" placeholder="Qty" inputMode="numeric" className="w-20" required aria-label="Quantity" />
                <Input name="note" placeholder="Note (optional)" className="min-w-32 flex-1" aria-label="Note" />
                <label className="flex items-center gap-1 pt-2 text-xs text-stone-600">
                  <input type="checkbox" name="allowLarge" />
                  large
                </label>
                <SubmitButton variant="secondary" pendingText="Adding…">
                  Add
                </SubmitButton>
              </ActionForm>
            )}
          </section>
        );
      })}
    </div>
  );
}
