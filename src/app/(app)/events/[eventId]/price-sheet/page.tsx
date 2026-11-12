import { getDb } from "@/db";
import { requirePermission } from "@/lib/auth";
import { loadEvent } from "@/lib/load";
import { formatCents } from "@/lib/money";
import { listItems } from "@/lib/services/items";
import { listStations } from "@/lib/services/stations";
import { PrintButton } from "@/components/forms";
import { Card, Notice, PageHeader } from "@/components/ui";

export const metadata = { title: "Code sheet" };

/**
 * A code list per table, so the people at each table can write codes on slips.
 * Printing puts each table on its own page.
 */
export default async function PriceSheetPage({ params }: PageProps<"/events/[eventId]/price-sheet">) {
  const { eventId } = await params;
  await requirePermission("viewItems");
  const ev = await loadEvent(eventId);
  const db = getDb();
  const [items, stations] = await Promise.all([listItems(db, ev.id), listStations(db, ev.id)]);
  const active = items.filter((i) => i.active);
  const groups = [
    ...stations.map((s) => ({ key: String(s.id), title: `${s.codePrefix} · ${s.name}`, items: active.filter((i) => i.stationId === s.id) })),
    { key: "none", title: "No table yet", items: active.filter((i) => i.stationId === null) },
  ].filter((g) => g.items.length);
  const missingPrice = active.some((i) => i.unitPriceCents === null);

  return (
    <>
      <PageHeader title="Code sheet" subtitle="Print one page per table so the people at each table can write codes on slips." actions={<PrintButton />} />
      {missingPrice && (
        <div className="mb-4 print:hidden">
          <Notice>Some items have no price yet and show as —.</Notice>
        </div>
      )}
      {groups.length === 0 && (
        <Card>
          <p className="text-sm text-stone-600">No active items yet.</p>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-2 print:block">
        {groups.map((g) => (
          <section key={g.key} className="break-inside-avoid rounded-lg border border-stone-200 bg-white p-5 shadow-sm print:break-after-page print:border-0 print:shadow-none">
            <div className="text-xs uppercase tracking-wide text-stone-500">{ev.name}</div>
            <h2 className="mt-1 text-xl font-bold">{g.title}</h2>
            <table className="mt-3 w-full text-base print:text-lg">
              <tbody>
                {g.items.map((it) => (
                  <tr key={it.id} className="border-b border-stone-100">
                    <td className="py-1.5 pr-4 font-mono text-lg font-bold">{it.code}</td>
                    <td className="py-1.5">
                      {it.name}
                      {it.unit !== "each" && <span className="text-sm text-stone-500"> ({it.unit})</span>}
                    </td>
                    <td className="py-1.5 text-right font-semibold tabular-nums">{formatCents(it.unitPriceCents)}</td>
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
