import Link from "next/link";
import { getDb } from "@/db";
import { requirePermission } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { listOutstanding, listPendingPayments } from "@/lib/services/sales";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader, Table, Td, Th } from "@/components/ui";
import { paymentStatusAction } from "../money-actions";

export const metadata = { title: "IOUs" };

export default async function IousPage() {
  const actor = await requirePermission("settleIous");
  const db = getDb();
  const [owing, pending] = await Promise.all([listOutstanding(db, actor), listPendingPayments(db, actor)]);
  const totalOwed = owing.reduce((s, m) => s + m.balanceCents, 0);
  const totalPending = pending.reduce((s, p) => s + p.p.amountCents, 0);

  return (
    <>
      <PageHeader
        title="IOUs and payments to confirm"
        subtitle="Balances are worked out from sales, payments and corrections. Nothing here is typed in by hand."
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <div className="text-xs font-medium uppercase tracking-wide text-stone-500">Still owed</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-amber-800">{formatCents(totalOwed)}</div>
          <div className="text-sm text-stone-500">{owing.length} members</div>
        </Card>
        <Card>
          <div className="text-xs font-medium uppercase tracking-wide text-stone-500">Venmo and checks not confirmed</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{formatCents(totalPending)}</div>
          <div className="text-sm text-stone-500">{pending.length} payments</div>
        </Card>
      </div>

      <h2 className="mb-2 text-lg font-semibold">Who owes money</h2>
      {owing.length === 0 ? (
        <Card>
          <p className="text-sm text-stone-600">Nobody owes anything.</p>
        </Card>
      ) : (
        <Table>
          <thead className="bg-stone-50">
            <tr>
              <Th>Member</Th>
              <Th>Account</Th>
              <Th className="text-right">Owed</Th>
              <Th className="text-right">Received</Th>
              <Th className="text-right">Still owed</Th>
              <Th>Notes</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {owing.map((m) => (
              <tr key={m.memberId}>
                <Td>
                  <Link href={`/members/${m.memberId}`} className="font-medium text-amber-800 hover:underline">
                    {m.name}
                  </Link>
                </Td>
                <Td className="font-mono text-xs">{m.accountNumber}</Td>
                <Td className="text-right tabular-nums">{formatCents(m.owedCents)}</Td>
                <Td className="text-right tabular-nums">
                  {formatCents(m.receivedCents)}
                  {m.pendingCents > 0 && <div className="text-xs text-amber-700">{formatCents(m.pendingCents)} unconfirmed</div>}
                </Td>
                <Td className="text-right font-semibold tabular-nums text-amber-800">{formatCents(m.balanceCents)}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {m.provisional && <Badge tone="amber">New member, confirm</Badge>}
                    {!m.contactConsent && <Badge>No contact consent</Badge>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <h2 className="mb-2 mt-8 text-lg font-semibold">Venmo and checks to confirm</h2>
      <p className="mb-3 text-sm text-stone-600">Choosing Venmo or check at the table only records what the customer said. Confirm each one once you see it in the Venmo account or the bank.</p>
      {pending.length === 0 ? (
        <Card>
          <p className="text-sm text-stone-600">Nothing waiting.</p>
        </Card>
      ) : (
        <Table>
          <thead className="bg-stone-50">
            <tr>
              <Th>Sale</Th>
              <Th>Customer</Th>
              <Th>Method</Th>
              <Th>Reference</Th>
              <Th className="text-right">Amount</Th>
              <Th>Taken</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {pending.map(({ p, customerName, saleId, eventId, receivedByName }) => (
              <tr key={p.id}>
                <Td>
                  <Link href={`/events/${eventId}/transactions/${saleId}`} className="font-mono text-amber-800 hover:underline">
                    #{saleId}
                  </Link>
                </Td>
                <Td>{customerName}</Td>
                <Td className="capitalize">{p.method}</Td>
                <Td>{p.reference ?? "—"}</Td>
                <Td className="text-right tabular-nums">{formatCents(p.amountCents)}</Td>
                <Td className="text-xs text-stone-500">
                  {p.receivedAt.toLocaleDateString("en-US")} by {receivedByName}
                </Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <ActionForm action={paymentStatusAction.bind(null, p.id, "cleared")} showSuccess={false}>
                      <SubmitButton variant="small">Confirm received</SubmitButton>
                    </ActionForm>
                    {p.method === "check" && (
                      <ActionForm action={paymentStatusAction.bind(null, p.id, "bounced")} confirm="Mark this check as bounced? The amount will be owed again." showSuccess={false}>
                        <SubmitButton variant="small">Bounced</SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
