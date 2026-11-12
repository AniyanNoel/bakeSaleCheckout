import Link from "next/link";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listEvents } from "@/lib/services/events";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Field, Input, PageHeader, Select, StatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { createEventAction } from "./actions";

export const metadata = { title: "Events" };

export default async function EventsPage() {
  const actor = await requireUser();
  const events = await listEvents(getDb());
  const isAdmin = can(actor.role, "manageEvents");
  const nextYear = new Date().getFullYear() + 1;

  return (
    <>
      <PageHeader title="Events" subtitle="Each year's sale keeps its own items, signups and records." />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-3">
          {events.length === 0 && (
            <Card>
              <p className="text-sm text-stone-600">
                No events yet.{isAdmin ? " Create the first one to start adding items." : " An admin needs to create one."}
              </p>
            </Card>
          )}
          {events.map((e) => (
            <Link
              key={e.id}
              href={`/events/${e.id}`}
              className="flex items-center justify-between rounded-lg border border-stone-200 bg-white px-5 py-4 shadow-sm hover:border-amber-300"
            >
              <div>
                <div className="font-semibold">{e.name}</div>
                <div className="text-sm text-stone-500">{e.saleDate ? formatDate(e.saleDate) : "Date not set"}</div>
              </div>
              <StatusBadge status={e.status} />
            </Link>
          ))}
        </div>

        {isAdmin && (
          <Card title="New event">
            <ActionForm action={createEventAction} className="space-y-4">
              <Field label="Name">
                <Input name="name" defaultValue={`Bake Sale ${nextYear}`} required />
              </Field>
              <Field label="Sale date" hint="Leave blank if it isn't decided yet.">
                <Input name="saleDate" type="date" />
              </Field>
              <Field label="Start from" hint="Copies stations and items with the same codes and prices. Signups and stock start empty.">
                <Select name="copyFrom" defaultValue={events[0]?.id ?? ""}>
                  <option value="">An empty list</option>
                  {events.map((e) => (
                    <option key={e.id} value={e.id}>
                      Copy items from {e.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <SubmitButton pendingText="Creating…">Create event</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
