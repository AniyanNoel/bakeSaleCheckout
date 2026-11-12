import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db";
import type { User } from "@/db/schema";
import { can, type Actor, type Permission } from "./permissions";
import { createSession, deleteSession, findSessionUser, toActor } from "./services/users";

const COOKIE = "bakesale_session";

/** The signed-in user for this request, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return findSessionUser(getDb(), token);
});

/** For pages: sends anyone not signed in to the login page. */
export async function requireUser(): Promise<Actor> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return toActor(u);
}

/**
 * For pages that need a permission: anyone without it sees the "no access" page.
 * Server actions don't need this, because every service checks permissions itself.
 */
export async function requirePermission(permission: Permission): Promise<Actor> {
  const actor = await requireUser();
  if (!can(actor.role, permission)) redirect("/no-access");
  return actor;
}

export async function startSession(userId: number): Promise<void> {
  const { token, expiresAt } = await createSession(getDb(), userId);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await deleteSession(getDb(), token);
  jar.delete(COOKIE);
}
