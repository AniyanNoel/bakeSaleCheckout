import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { loadCatalog } from "@/lib/services/catalog";
import { toActor } from "@/lib/services/users";

/** Item list and member numbers for the checkout screen to keep on the device. */
export async function GET(_req: Request, ctx: RouteContext<"/api/events/[eventId]/catalog">) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "signed out" }, { status: 401 });
  const actor = toActor(user);
  if (!can(actor.role, "checkout")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { eventId } = await ctx.params;
  const catalog = await loadCatalog(getDb(), actor, Number(eventId));
  if (!catalog) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(catalog, { headers: { "Cache-Control": "no-store" } });
}
