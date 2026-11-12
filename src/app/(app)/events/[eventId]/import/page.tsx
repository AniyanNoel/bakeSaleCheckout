import { getDb } from "@/db";
import { requirePermission } from "@/lib/auth";
import { loadEvent } from "@/lib/load";
import { listStations } from "@/lib/services/stations";
import { Notice } from "@/components/ui";
import { ImportWizard } from "./wizard";

export const metadata = { title: "Import items" };

export default async function ImportPage({ params }: PageProps<"/events/[eventId]/import">) {
  const { eventId } = await params;
  await requirePermission("manageItems");
  const ev = await loadEvent(eventId);
  if (ev.status === "closed") return <Notice>This event is closed, so nothing can be imported into it.</Notice>;
  const stations = await listStations(getDb(), ev.id);
  return (
    <div className="max-w-5xl space-y-4">
      <div className="text-sm text-stone-600">
        <p>
          Bring in items and prices from last year&apos;s Google Sheet. In Google Sheets choose{" "}
          <strong>File → Download → Microsoft Excel (.xlsx)</strong> so every tab comes along, then upload it here. A single tab
          saved as .csv works too.
        </p>
        <p className="mt-2">You&apos;ll see everything before it&apos;s saved. Items already in this event (same name) are skipped, so it&apos;s safe to import again. The IOU table on the Finance tab is not imported.</p>
      </div>
      <ImportWizard eventId={ev.id} stations={stations.map((s) => ({ id: s.id, label: `${s.codePrefix} · ${s.name}` }))} />
    </div>
  );
}
