import type { Role } from "@/db/schema";
import { ForbiddenError } from "./errors";

/**
 * One person runs the app (the cashier at the checkout table), so every signed-in
 * account can do everything. The list stays so pages and services still say what
 * they need, which makes adding roles later a small change.
 */
export const PERMISSIONS = ["manageEvents", "manageItems", "manageMembers", "manageUsers", "checkout", "viewItems"] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type Actor = { id: number; role: Role; name: string };

export function can(role: Role, _permission: Permission): boolean {
  return role === "admin";
}

export function assertCan(actor: Actor, permission: Permission): void {
  if (!can(actor.role, permission)) throw new ForbiddenError();
}
