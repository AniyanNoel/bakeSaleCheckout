import { getDb } from "@/db";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { loadEvent } from "@/lib/load";
import { bringList } from "@/lib/services/signups";
import { PrintButton } from "@/components/forms";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Bring list" };

/** One block per volunteer: what they said they'd bring. Prints one per page. */
export default async function BringListPage({ params }: PageProps<"/events/[eventId]/bring-list">) {
  const { eventId } = await params;
  await requirePermission("manageSignups");
  const ev = await loadEvent(eventId);
  const list = await bringList(getDb(), ev.id);

  return (
    <>
      <PageHeader title="Bring list" subtitle={`${list.length} volunteers. Printing puts each volunteer on their own page.`} actions={<PrintButton />} />
      {list.length === 0 && (
        <Card>
          <p className="text-sm text-stone-600">No signups yet.</p>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-2 print:block">
        {list.map((v) => (
          <section key={v.volunteerId} className="break-inside-avoid rounded-lg border border-stone-200 bg-white p-5 shadow-sm print:mb-0 print:break-after-page print:border-0 print:shadow-none">
            <div className="text-xs uppercase tracking-wide text-stone-500">
              {ev.name}
              {ev.saleDate && ` · ${formatDate(ev.saleDate)}`}
            </div>
            <h2 className="mt-1 text-lg font-bold">{v.volunteerName}</h2>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
                  <th className="py-1">Code</th>
                  <th className="py-1">Item</th>
                  <th className="py-1 text-right">Qty</th>
                  <th className="py-1 pl-3">Station</th>
                </tr>
              </thead>
              <tbody>
                {v.lines.map((l, i) => (
                  <tr key={i} className="border-b border-stone-100">
                    <td className="py-1 font-mono">{l.code}</td>
                    <td className="py-1">
                      {l.itemName}
                      {l.note && <div className="text-xs text-stone-500">{l.note}</div>}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {l.qty ?? "?"} {l.unit !== "each" && <span className="text-stone-500">{l.unit}</span>}
                    </td>
                    <td className="py-1 pl-3 text-stone-600">{l.station ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </>
  );
}
