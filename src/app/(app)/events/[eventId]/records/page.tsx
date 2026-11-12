import { getDb } from "@/db";
import { requirePermission } from "@/lib/auth";
import { loadEvent } from "@/lib/load";
import { formatCents } from "@/lib/money";
import {
  eventTotals,
  itemsSummary,
  listCheckouts,
  METHOD_LABELS,
  type CheckoutFilter,
} from "@/lib/services/checkouts";
import { ActionForm, SubmitButton } from "@/components/forms";
import {
  Badge,
  buttonClass,
  Card,
  Input,
  Select,
  Table,
  Td,
  Th,
} from "@/components/ui";
import {
  deleteCheckoutAction,
  markPaidAction,
  updateCheckoutAction,
} from "./actions";

export const metadata = { title: "Records" };

const timeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  day: "numeric",
  timeZone: "America/New_York",
});

export default async function RecordsPage({
  params,
  searchParams,
}: PageProps<"/events/[eventId]/records">) {
  const { eventId } = await params;
  const sp = await searchParams;
  const actor = await requirePermission("checkout");
  const ev = await loadEvent(eventId);
  const q = typeof sp.q === "string" ? sp.q : "";
  const show =
    (["all", "unpaid", "paid"] as const).find((s) => s === sp.show) ?? "all";
  const filter: CheckoutFilter = { q, show };
  const db = getDb();
  const [rows, t] = await Promise.all([
    listCheckouts(db, actor, ev.id, filter),
    eventTotals(db, actor, ev.id),
  ]);
  const exportHref = `/api/events/${ev.id}/records.xlsx`;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Total sold
          </div>
          <div
            className="mt-1 text-2xl font-bold tabular-nums"
            data-testid="total-sold"
          >
            {formatCents(t.totalCents)}
          </div>
          <div className="text-sm text-stone-500">
            {t.count} checkout{t.count === 1 ? "" : "s"}
          </div>
        </Card>
        <Card>
          <div className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Paid
          </div>
          <div
            className="mt-1 text-2xl font-bold tabular-nums text-green-800"
            data-testid="total-paid"
          >
            {formatCents(t.paidCents)}
          </div>
          <div className="text-sm text-stone-500">
            Cash {formatCents(t.byMethod.cash)} · Venmo{" "}
            {formatCents(t.byMethod.venmo)} · Check{" "}
            {formatCents(t.byMethod.check)}
          </div>
        </Card>
        <Card>
          <div className="text-xs font-medium uppercase tracking-wide text-stone-500">
            Not paid yet
          </div>
          <div
            className="mt-1 text-2xl font-bold tabular-nums text-amber-800"
            data-testid="total-unpaid"
          >
            {formatCents(t.unpaidCents)}
          </div>
          <div className="text-sm text-stone-500">
            {t.unpaidCount} checkout{t.unpaidCount === 1 ? "" : "s"}
          </div>
        </Card>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <form className="flex flex-wrap items-end gap-2" action="">
          <div className="w-60">
            <Input
              name="q"
              defaultValue={q}
              placeholder="Search name or account #"
              aria-label="Search"
            />
          </div>
          <div className="w-40">
            <Select name="show" defaultValue={show} aria-label="Show">
              <option value="all">Everyone</option>
              <option value="unpaid">Not paid yet</option>
              <option value="paid">Paid</option>
            </Select>
          </div>
          <button className={buttonClass.secondary}>Show</button>
        </form>
        <a href={exportHref} className={`${buttonClass.secondary} ml-auto`}>
          Download Excel
        </a>
      </div>

      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-stone-600">
            {t.count
              ? "No checkouts match."
              : "No checkouts yet. They show up here as soon as you save one."}
          </p>
        </Card>
      ) : (
        <Table>
          <thead className="bg-stone-50">
            <tr>
              <Th>Name</Th>
              <Th>Account</Th>
              <Th>Items purchased</Th>
              <Th className="text-right">Total</Th>
              <Th>Payment</Th>
              <Th>Paid?</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((c) => (
              <tr key={c.id} className="align-top">
                <Td>
                  <div className="font-medium">{c.customerName}</div>
                  <div className="text-xs text-stone-500">
                    {timeFmt.format(c.soldAt)}
                  </div>
                  {c.note && (
                    <div className="text-xs text-stone-500">{c.note}</div>
                  )}
                </Td>
                <Td className="font-mono">{c.accountNumber ?? "—"}</Td>
                <Td>
                  <span
                    className="font-mono text-xs"
                    title={c.lines
                      .map((l) => `${l.itemCode} ${l.itemName} x${l.quantity}`)
                      .join("\n")}
                  >
                    {itemsSummary(c.lines)}
                  </span>
                </Td>
                <Td className="text-right font-semibold tabular-nums">
                  {formatCents(c.totalCents)}
                </Td>
                <Td>
                  {c.paymentMethod ? METHOD_LABELS[c.paymentMethod] : "—"}
                </Td>
                <Td>
                  {c.paid ? (
                    <Badge tone="green">Yes</Badge>
                  ) : (
                    <div className="flex flex-col items-start gap-1">
                      <Badge tone="amber">No</Badge>
                      {c.paymentMethod && (
                        <ActionForm
                          action={markPaidAction.bind(
                            null,
                            c.id,
                            c.paymentMethod,
                          )}
                          showSuccess={false}
                        >
                          <input
                            type="hidden"
                            name="note"
                            value={c.note ?? ""}
                          />
                          <SubmitButton variant="small">Mark paid</SubmitButton>
                        </ActionForm>
                      )}
                    </div>
                  )}
                </Td>
                <Td>
                  <details>
                    <summary className="cursor-pointer text-sm text-amber-800">
                      Edit
                    </summary>
                    <div className="mt-2 w-64 space-y-3">
                      <ActionForm
                        action={updateCheckoutAction.bind(null, c.id)}
                        className="space-y-2"
                        showSuccess={false}
                      >
                        <Select
                          name="paymentMethod"
                          defaultValue={c.paymentMethod ?? ""}
                          aria-label="Payment"
                        >
                          <option value="">No payment yet</option>
                          <option value="cash">Cash</option>
                          <option value="venmo">Venmo</option>
                          <option value="check">Check</option>
                        </Select>
                        <Select
                          name="paid"
                          defaultValue={c.paid ? "yes" : "no"}
                          aria-label="Paid"
                        >
                          <option value="yes">Paid</option>
                          <option value="no">Not paid yet</option>
                        </Select>
                        <Input
                          name="note"
                          defaultValue={c.note ?? ""}
                          placeholder="Note"
                          aria-label="Note"
                        />
                        <SubmitButton variant="secondary">Save</SubmitButton>
                      </ActionForm>
                      <ActionForm
                        action={deleteCheckoutAction.bind(null, c.id)}
                        confirm={`Delete ${c.customerName}'s checkout for ${formatCents(c.totalCents)}? Only do this if it was rung up by mistake.`}
                        showSuccess={false}
                      >
                        <SubmitButton variant="danger">
                          Delete checkout
                        </SubmitButton>
                      </ActionForm>
                      <ul className="text-xs text-stone-600">
                        {c.lines.map((l) => (
                          <li key={l.id}>
                            {l.itemCode} {l.itemName} × {l.quantity} ={" "}
                            {formatCents(l.lineTotalCents)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </details>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
