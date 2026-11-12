import Link from "next/link";
import { getDb } from "@/db";
import { requirePermission } from "@/lib/auth";
import { loadEvent } from "@/lib/load";
import { formatCents } from "@/lib/money";
import { listTransactions } from "@/lib/services/sales";
import { Badge, Card, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Transactions" };

export default async function TransactionsPage({ params, searchParams }: PageProps<"/events/[eventId]/transactions">) {
  const { eventId } = await params;
  const sp = await searchParams;
  const actor = await requirePermission("viewTransactions");
  const ev = await loadEvent(eventId);
  const mine = sp.mine === "1";
  const rows = await listTransactions(getDb(), actor, ev.id, { createdBy: mine ? actor.id : undefined });
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  const shown = q ? rows.filter((r) => r.customerName.toLowerCase().includes(q) || (r.memberAccount ?? "").toLowerCase().includes(q) || String(r.id) === q) : rows;
  const base = `/events/${ev.id}/transactions`;

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-center gap-2" action={base}>
        <input name="q" defaultValue={q} placeholder="Search name, account or sale #" className="w-64 rounded-md border border-stone-300 px-3 py-2 text-sm" />
        {mine && <input type="hidden" name="mine" value="1" />}
        <button className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm">Search</button>
        <span className="ml-2 text-sm">
          <Link href={mine ? base : `${base}?mine=1`} className="text-amber-800 hover:underline">
            {mine ? "Show everyone's sales" : "Show only my sales"}
          </Link>
        </span>
        <span className="ml-auto text-sm text-stone-500">{shown.length} sales</span>
      </form>
      {shown.length === 0 ? (
        <Card>
          <p className="text-sm text-stone-600">No sales yet.</p>
        </Card>
      ) : (
        <Table>
          <thead className="bg-stone-50">
            <tr>
              <Th>#</Th>
              <Th>Time</Th>
              <Th>Customer</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Received</Th>
              <Th className="text-right">Owed</Th>
              <Th>Paid by</Th>
              <Th>Cashier</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {shown.map((t) => (
              <tr key={t.id} className={t.status === "voided" ? "text-stone-400" : ""}>
                <Td>
                  <Link href={`${base}/${t.id}`} className="font-mono font-semibold text-amber-800 hover:underline">
                    {t.id}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap text-xs">{t.soldAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</Td>
                <Td>
                  {t.customerName}
                  {t.memberAccount && <span className="ml-1 font-mono text-xs text-stone-500">{t.memberAccount}</span>}
                </Td>
                <Td className="text-right tabular-nums">{formatCents(t.totalCents)}</Td>
                <Td className="text-right tabular-nums">{formatCents(t.receivedCents)}</Td>
                <Td className={`text-right tabular-nums ${t.balanceCents > 0 ? "font-semibold text-amber-800" : ""}`}>{t.balanceCents ? formatCents(t.balanceCents) : "—"}</Td>
                <Td className="text-xs">{t.methods.join(", ") || (t.balanceCents > 0 ? "IOU" : "—")}</Td>
                <Td className="text-xs">{t.createdByName}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {t.status === "voided" && <Badge>Voided</Badge>}
                    {t.donationCents > 0 && <Badge tone="blue">Donation</Badge>}
                    {t.flags.length > 0 && <Badge tone="amber">Check</Badge>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
