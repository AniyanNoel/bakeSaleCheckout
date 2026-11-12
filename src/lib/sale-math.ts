/**
 * The arithmetic for one checkout, shared by the checkout screen (for the live
 * total) and the server (which recomputes everything and is what counts).
 * All amounts are integer cents.
 */
import type { PaymentMethod } from "@/db/schema";

export type CartLine = { unitPriceCents: number; quantity: number };
export type TenderedPayment = { method: PaymentMethod; amountCents: number };
export type Overpay = "change" | "donation";

export type SaleTotals = {
  totalCents: number;
  tenderedCents: number;
  /** Cash handed back to the customer. */
  changeCents: number;
  donationCents: number;
  /** What is still owed after this checkout: becomes an IOU. */
  balanceCents: number;
  /** Payments as they will be recorded (cash reduced by any change given). */
  applied: TenderedPayment[];
  problem: string | null;
};

export function lineTotal(l: CartLine): number {
  return l.unitPriceCents * l.quantity;
}

export function computeSale(lines: CartLine[], tendered: TenderedPayment[], overpay: Overpay): SaleTotals {
  const totalCents = lines.reduce((s, l) => s + lineTotal(l), 0);
  const positive = tendered.filter((p) => p.amountCents > 0);
  const tenderedCents = positive.reduce((s, p) => s + p.amountCents, 0);
  const excess = Math.max(0, tenderedCents - totalCents);
  const base = { totalCents, tenderedCents, problem: null as string | null };

  if (excess === 0) {
    return { ...base, changeCents: 0, donationCents: 0, balanceCents: totalCents - tenderedCents, applied: positive };
  }
  if (overpay === "donation") {
    return { ...base, changeCents: 0, donationCents: excess, balanceCents: 0, applied: positive };
  }
  // Change can only come out of cash. Take it from the cash payments, last first.
  const cash = positive.filter((p) => p.method === "cash").reduce((s, p) => s + p.amountCents, 0);
  if (cash < excess) {
    return {
      ...base,
      changeCents: 0,
      donationCents: 0,
      balanceCents: 0,
      applied: positive,
      problem: "Venmo and check payments are more than the total. Lower them, or keep the extra as a donation.",
    };
  }
  let toRemove = excess;
  const applied: TenderedPayment[] = [];
  for (const p of [...positive].reverse()) {
    if (p.method === "cash" && toRemove > 0) {
      const cut = Math.min(p.amountCents, toRemove);
      toRemove -= cut;
      if (p.amountCents - cut > 0) applied.unshift({ ...p, amountCents: p.amountCents - cut });
    } else {
      applied.unshift(p);
    }
  }
  return { ...base, changeCents: excess, donationCents: 0, balanceCents: 0, applied };
}

/** Money owed, received and outstanding for one sale. Bounced payments don't count. */
export function saleBalance(t: { totalCents: number; donationCents: number }, adjustmentsCents: number, receivedCents: number) {
  const owed = t.totalCents + t.donationCents + adjustmentsCents;
  return { owedCents: owed, receivedCents, balanceCents: owed - receivedCents };
}
