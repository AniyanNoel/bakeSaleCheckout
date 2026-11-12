import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { UserError } from "@/lib/errors";
import { submitCheckout } from "@/lib/services/checkouts";
import { toActor } from "@/lib/services/users";

/**
 * The checkout screen sends each checkout here. Safe to retry: the same
 * clientId always returns the same checkout.
 *
 * 200 saved (or already saved), 401 signed out, 422 needs fixing (kept on the device), 500 try again.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You've been signed out. Sign in again to send this checkout." }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "The checkout data was unreadable." }, { status: 400 });
  }
  try {
    const { checkout: c, duplicate } = await submitCheckout(getDb(), toActor(user), body);
    return NextResponse.json({ id: c.id, duplicate, totalCents: c.totalCents, customerName: c.customerName, accountNumber: c.accountNumber, paid: c.paid });
  } catch (err) {
    if (err instanceof UserError) return NextResponse.json({ error: err.message }, { status: 422 });
    console.error(err);
    return NextResponse.json({ error: "The server had a problem. The checkout is kept on this device and will be sent again." }, { status: 500 });
  }
}
