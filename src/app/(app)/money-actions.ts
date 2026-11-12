"use server";

import { getDb } from "@/db";
import type { PaymentMethod } from "@/db/schema";
import { bool, run, str, type ActionState } from "@/lib/action";
import { requireUser } from "@/lib/auth";
import { UserError } from "@/lib/errors";
import { parseDollarsToCents } from "@/lib/money";
import { createMember, updateMember } from "@/lib/services/members";
import { refundTransaction, setPaymentStatus, settleMemberBalance, voidTransaction, writeOff } from "@/lib/services/sales";

function dollars(fd: FormData, key: string): number {
  const c = parseDollarsToCents(str(fd, key));
  if (c === undefined || c === null || c <= 0) throw new UserError("Enter an amount like 5 or 5.50.");
  return c;
}

function method(v: string): PaymentMethod {
  if (v === "cash" || v === "venmo" || v === "check") return v;
  throw new UserError("Choose cash, Venmo or check.");
}

export async function voidAction(txId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    await voidTransaction(getDb(), actor, txId, str(fd, "reason"));
    return "Sale voided. Hand back any money listed as returned.";
  });
}

export async function refundAction(txId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    const back = str(fd, "returnMethod");
    await refundTransaction(getDb(), actor, txId, { amountCents: dollars(fd, "amount"), reason: str(fd, "reason"), returnMethod: back ? method(back) : null });
    return "Refund recorded.";
  });
}

export async function writeOffAction(txId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    await writeOff(getDb(), actor, txId, { amountCents: dollars(fd, "amount"), reason: str(fd, "reason") });
    return "Written off.";
  });
}

export async function paymentStatusAction(paymentId: number, status: "cleared" | "bounced" | "pending", _prev: ActionState): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    await setPaymentStatus(getDb(), actor, paymentId, status);
    return status === "cleared" ? "Marked as received in the account." : status === "bounced" ? "Marked as bounced. The balance is owed again." : "Marked as pending.";
  });
}

export async function settleAction(memberId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    const r = await settleMemberBalance(getDb(), actor, memberId, {
      method: method(str(fd, "method")),
      amountCents: dollars(fd, "amount"),
      reference: str(fd, "reference"),
      note: str(fd, "note"),
    });
    return `Payment recorded against ${r.applied.length} sale${r.applied.length > 1 ? "s" : ""}.`;
  });
}

function memberFields(fd: FormData) {
  return {
    accountNumber: str(fd, "accountNumber"),
    name: str(fd, "name"),
    phone: str(fd, "phone"),
    email: str(fd, "email"),
    contactConsent: bool(fd, "contactConsent"),
    contactConsentNote: str(fd, "contactConsentNote"),
    active: fd.has("activePresent") ? bool(fd, "active") : true,
  };
}

export async function createMemberAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    const m = await createMember(getDb(), actor, memberFields(fd));
    return `Added ${m.name}.`;
  });
}

export async function updateMemberAction(memberId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    await updateMember(getDb(), actor, memberId, memberFields(fd));
    return "Member saved and confirmed.";
  });
}
