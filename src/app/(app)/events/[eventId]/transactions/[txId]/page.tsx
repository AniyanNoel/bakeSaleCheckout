import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requirePermission } from "@/lib/auth";
import { VOID_WINDOW_MINUTES } from "@/lib/constants";
import { loadEvent } from "@/lib/load";
import { formatCents } from "@/lib/money";
import { can } from "@/lib/permissions";
import { canVoid, getTransactionDetail } from "@/lib/services/sales";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Field, Input, Notice, Select, TextLink } from "@/components/ui";
import { paymentStatusAction, refundAction, voidAction, writeOffAction } from "../../../../money-actions";

export const metadata = { title: "Sale" };

const STATUS_TONE = { received: "green", cleared: "green", pending: "amber", bounced: "red" } as const;
const STATUS_LABEL = { received: "Received", cleared: "Confirmed", pending: "Not confirmed yet", bounced: "Bounced" } as const;

export default async function TransactionPage({ params }: PageProps<"/events/[eventId]/transactions/[txId]">) {
  const { eventId, txId } = await params;
  const actor = await requirePermission("viewTransactions");
  const ev = await loadEvent(eventId);
  const t = await getTransactionDetail(getDb(), Number(txId));
  if (!t || t.eventId !== ev.id) notFound();
  const admin = can(actor.role, "voidAny");
  const voidable = canVoid(actor, t);

  return (
    <div className="max-w-4xl space-y-6">
      <TextLink href={`/events/${ev.id}/transactions`}>← All sales</TextLink>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold">Sale #{t.id}</h2>
        {t.status === "voided" ? <Badge>Voided</Badge> : <Badge tone="green">Completed</Badge>}
        <span className="text-sm text-stone-500">
          {t.soldAt.toLocaleString("en-US")} · rung up by {t.createdByName}
        </span>
      </div>

      {t.flags.length > 0 && (
        <Notice>
          <p className="font-semibold">Worth checking</p>
          <ul className="mt-1 list-disc pl-5">
            {t.flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        <Money label="Total sale" cents={t.totalCents} />
        <Money label="Owed now" cents={t.owedCents} hint={t.donationCents ? `includes ${formatCents(t.donationCents)} donation` : undefined} />
        <Money label="Received" cents={t.receivedCents} hint={t.pendingCents ? `${formatCents(t.pendingCents)} not confirmed yet` : undefined} />
        <Money label="Still owed" cents={t.balanceCents} tone={t.balanceCents > 0 ? "amber" : undefined} />
      </div>

      <Card title="Customer">
        <p className="text-sm">
          {t.memberId ? (
            admin ? (
              <Link href={`/members/${t.memberId}`} className="font-medium text-amber-800 hover:underline">
                {t.customerName}
              </Link>
            ) : (
              <span className="font-medium">{t.customerName}</span>
            )
          ) : (
            <span className="font-medium">{t.customerName}</span>
          )}
          {t.memberAccount && <span className="ml-2 font-mono text-stone-500">Account {t.memberAccount}</span>}
        </p>
      </Card>

      <Card title="Items">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-stone-100">
            {t.lines.map((l) => (
              <tr key={l.id}>
                <td className="py-1.5 font-mono">{l.itemCode}</td>
                <td className="py-1.5">
                  {l.itemName}
                  {l.note && <div className="text-xs text-stone-500">{l.note}</div>}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {l.quantity} × {formatCents(l.unitPriceCents)}
                </td>
                <td className="py-1.5 text-right font-medium tabular-nums">{formatCents(l.lineTotalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Payments">
        {t.payments.length === 0 ? (
          <p className="text-sm text-stone-500">No payments yet.</p>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {t.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="w-16 font-medium capitalize">{p.method}</span>
                <span className={`w-20 text-right tabular-nums ${p.amountCents < 0 ? "text-red-700" : ""}`}>{formatCents(p.amountCents)}</span>
                <Badge tone={STATUS_TONE[p.status]}>{p.amountCents < 0 ? "Handed back" : STATUS_LABEL[p.status]}</Badge>
                {p.reference && <span className="text-stone-600">{p.method === "check" ? `Check #${p.reference}` : p.reference}</span>}
                {p.settlementId && <Badge tone="blue">Later IOU payment</Badge>}
                <span className="text-xs text-stone-500">
                  {p.receivedAt.toLocaleString("en-US")} by {p.receivedByName}
                </span>
                {p.note && <span className="w-full text-xs text-stone-500">{p.note}</span>}
                {admin && p.method !== "cash" && p.amountCents > 0 && (
                  <span className="ml-auto flex gap-1">
                    {p.status !== "cleared" && (
                      <ActionForm action={paymentStatusAction.bind(null, p.id, "cleared")} showSuccess={false}>
                        <SubmitButton variant="small">Confirm received</SubmitButton>
                      </ActionForm>
                    )}
                    {p.method === "check" && p.status !== "bounced" && (
                      <ActionForm action={paymentStatusAction.bind(null, p.id, "bounced")} confirm="Mark this check as bounced? The amount will be owed again." showSuccess={false}>
                        <SubmitButton variant="small">Bounced</SubmitButton>
                      </ActionForm>
                    )}
                    {p.status !== "pending" && (
                      <ActionForm action={paymentStatusAction.bind(null, p.id, "pending")} showSuccess={false}>
                        <SubmitButton variant="small">Undo</SubmitButton>
                      </ActionForm>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {t.adjustments.length > 0 && (
        <Card title="Corrections">
          <ul className="divide-y divide-stone-100 text-sm">
            {t.adjustments.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-2 py-2">
                <Badge>{a.kind.replace("_", "-")}</Badge>
                <span className="tabular-nums">{formatCents(a.amountCents)}</span>
                <span>{a.reason}</span>
                <span className="text-xs text-stone-500">
                  {a.createdAt.toLocaleString("en-US")} by {a.createdByName}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {t.status === "completed" && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Void this sale">
            {voidable ? (
              <ActionForm action={voidAction.bind(null, t.id)} confirm="Void this sale? Any money taken is recorded as handed back." className="space-y-3">
                <p className="text-sm text-stone-600">For a sale rung up wrong. It stays in the records, marked voided. Then ring it up again.</p>
                <Input name="reason" placeholder="Reason, e.g. wrong member" required />
                <SubmitButton variant="danger" pendingText="Voiding…">
                  Void sale
                </SubmitButton>
              </ActionForm>
            ) : (
              <p className="text-sm text-stone-600">Cashiers can void their own sales within {VOID_WINDOW_MINUTES} minutes. Ask an admin to void this one.</p>
            )}
          </Card>
          {admin && (
            <Card title="Refund or write off">
              <ActionForm action={refundAction.bind(null, t.id)} className="space-y-3" resetOnSuccess>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Amount ($)">
                    <Input name="amount" inputMode="decimal" required />
                  </Field>
                  <Field label="Money handed back by">
                    <Select name="returnMethod" defaultValue="cash">
                      <option value="cash">Cash</option>
                      <option value="venmo">Venmo</option>
                      <option value="check">Check</option>
                      <option value="">Nothing handed back (lower what they owe)</option>
                    </Select>
                  </Field>
                </div>
                <Input name="reason" placeholder="Reason" required />
                <SubmitButton variant="secondary">Record refund</SubmitButton>
              </ActionForm>
              {t.balanceCents > 0 && (
                <ActionForm action={writeOffAction.bind(null, t.id)} className="mt-4 space-y-3 border-t border-stone-100 pt-4" confirm="Write this off? It will no longer be owed." resetOnSuccess>
                  <p className="text-sm text-stone-600">Write off an IOU that won&apos;t be collected.</p>
                  <div className="flex gap-2">
                    <Input name="amount" inputMode="decimal" defaultValue={(t.balanceCents / 100).toFixed(2)} className="w-28" required aria-label="Amount" />
                    <Input name="reason" placeholder="Reason" required aria-label="Reason" />
                  </div>
                  <SubmitButton variant="secondary">Write off</SubmitButton>
                </ActionForm>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function Money({ label, cents, hint, tone }: { label: string; cents: number; hint?: string; tone?: "amber" }) {
  return (
    <div className={`rounded-lg border bg-white p-4 shadow-sm ${tone === "amber" ? "border-amber-300" : "border-stone-200"}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${tone === "amber" ? "text-amber-800" : ""}`}>{formatCents(cents)}</div>
      {hint && <div className="text-xs text-stone-500">{hint}</div>}
    </div>
  );
}
