"use server";

import { getDb } from "@/db";
import { run, str, type ActionState } from "@/lib/action";
import { requireUser } from "@/lib/auth";
import { deleteCheckout, updateCheckout } from "@/lib/services/checkouts";

export async function updateCheckoutAction(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    await updateCheckout(getDb(), actor, id, {
      paid: str(fd, "paid") === "yes",
      paymentMethod: str(fd, "paymentMethod") || null,
      note: str(fd, "note"),
    });
  });
}

/** One click: mark paid, keeping the payment method they already picked. */
export async function markPaidAction(id: number, method: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    await updateCheckout(getDb(), actor, id, { paid: true, paymentMethod: str(fd, "paymentMethod") || method, note: str(fd, "note") });
  });
}

export async function deleteCheckoutAction(id: number, _prev: ActionState): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    await deleteCheckout(getDb(), actor, id);
  });
}
