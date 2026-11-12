import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requirePermission } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { getMember } from "@/lib/services/members";
import { memberPayments, memberSales } from "@/lib/services/sales";
import { ActionForm, SubmitButton } from "@/components/forms";
import { MemberFields } from "@/components/member-fields";
import { Badge, Card, Field, Input, Notice, Select, Table, Td, TextLink, Th } from "@/components/ui";
import { settleAction, updateMemberAction } from "../../money-actions";

export const metadata = { title: "Member" };

export default async function MemberPage({ params }: PageProps<"/members/[memberId]">) {
  const { memberId } = await params;
  const actor = await requirePermission("manageMembers");
  const db = getDb();
  const m = await getMember(db, actor, Number(memberId));
  if (!m) notFound();
  const [sales, pays] = await Promise.all([memberSales(db, m.id), memberPayments(db, m.id)]);
  const balance = sales.reduce((s, t) => s + t.balanceCents, 0);

  return (
    <div className="space-y-6">
      <TextLink href="/members">← All members</TextLink>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{m.name}</h1>
        <span className="font-mono text-stone-500">{m.accountNumber}</span>
        {m.provisional && <Badge tone="amber">Added at checkout, not confirmed</Badge>}
      </div>
      {m.provisional && <Notice>A cashier added this member at checkout. Check the account number and name, then press Save to confirm.</Notice>}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card title={`Sales · ${balance > 0 ? `${formatCents(balance)} still owed` : "nothing owed"}`}>
            {sales.length === 0 ? (
              <p className="text-sm text-stone-500">No sales.</p>
            ) : (
              <Table>
                <thead className="bg-stone-50">
                  <tr>
                    <Th>Sale</Th>
                    <Th>Date</Th>
                    <Th className="text-right">Total</Th>
                    <Th className="text-right">Received</Th>
                    <Th className="text-right">Still owed</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {sales.map((t) => (
                    <tr key={t.id} className={t.status === "voided" ? "text-stone-400" : ""}>
                      <Td>
                        <Link href={`/events/${t.eventId}/transactions/${t.id}`} className="font-mono text-amber-800 hover:underline">
                          #{t.id}
                        </Link>
                        {t.status === "voided" && <span className="ml-1 text-xs">voided</span>}
                      </Td>
                      <Td className="text-xs">{t.soldAt.toLocaleDateString("en-US")}</Td>
                      <Td className="text-right tabular-nums">{formatCents(t.totalCents)}</Td>
                      <Td className="text-right tabular-nums">{formatCents(t.receivedCents)}</Td>
                      <Td className={`text-right tabular-nums ${t.balanceCents > 0 ? "font-semibold text-amber-800" : ""}`}>{t.balanceCents ? formatCents(t.balanceCents) : "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card title="Payment history">
            {pays.length === 0 ? (
              <p className="text-sm text-stone-500">No payments.</p>
            ) : (
              <ul className="divide-y divide-stone-100 text-sm">
                {pays.map(({ p, receivedByName, saleId }) => (
                  <li key={p.id} className="flex flex-wrap gap-2 py-1.5">
                    <span className="w-24 text-xs text-stone-500">{p.receivedAt.toLocaleDateString("en-US")}</span>
                    <span className="w-14 capitalize">{p.method}</span>
                    <span className={`w-20 text-right tabular-nums ${p.amountCents < 0 ? "text-red-700" : ""}`}>{formatCents(p.amountCents)}</span>
                    <Badge tone={p.status === "pending" ? "amber" : p.status === "bounced" ? "red" : "green"}>{p.status}</Badge>
                    <span className="text-xs text-stone-500">
                      sale #{saleId} · {receivedByName}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {balance > 0 && (
            <Card title="Record a payment">
              <ActionForm action={settleAction.bind(null, m.id)} resetOnSuccess className="space-y-3">
                <p className="text-sm text-stone-600">Applied to the oldest unpaid sale first.</p>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Amount ($)">
                    <Input name="amount" inputMode="decimal" defaultValue={(balance / 100).toFixed(2)} required />
                  </Field>
                  <Field label="Method">
                    <Select name="method" defaultValue="cash">
                      <option value="cash">Cash</option>
                      <option value="venmo">Venmo</option>
                      <option value="check">Check</option>
                    </Select>
                  </Field>
                </div>
                <Input name="reference" placeholder="Check number or Venmo note" aria-label="Reference" />
                <Input name="note" placeholder="Note (optional)" aria-label="Note" />
                <SubmitButton>Record payment</SubmitButton>
              </ActionForm>
            </Card>
          )}
          <Card title="Details">
            <ActionForm action={updateMemberAction.bind(null, m.id)} className="space-y-4">
              <MemberFields member={m} />
              <SubmitButton>{m.provisional ? "Save and confirm" : "Save"}</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>
    </div>
  );
}
