import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { UserError } from "@/lib/errors";
import { submitSale } from "@/lib/services/sales";
import { toActor } from "@/lib/services/users";

/**
 * The checkout screen's outbox sends sales here. Safe to retry: the same
 * clientId always returns the same sale.
 *
 * Responses: 200 saved (or already saved), 401 signed out, 422 the sale needs a
 * person to fix it (it stays on the device), 500 try again later.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You've been signed out. Sign in again to send this sale." }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "The sale data was unreadable." }, { status: 400 });
  }
  try {
    const r = await submitSale(getDb(), toActor(user), body);
    return NextResponse.json({
      id: r.transaction.id,
      duplicate: r.duplicate,
      totalCents: r.transaction.totalCents,
      balanceCents: r.balanceCents,
      flags: r.transaction.flags,
      customerName: r.transaction.customerName,
    });
  } catch (err) {
    if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: 422 });
    console.error(err);
    return NextResponse.json({ error: "The server had a problem. The sale is kept on this device and will be sent again." }, { status: 500 });
  }
}
