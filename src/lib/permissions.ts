import type { Role } from "@/db/schema";
import { ForbiddenError } from "./errors";

/**
 * Who can do what. Matches the roles table in the design doc. Later phases add
 * checkout, payments and reports to this list.
 */
const MATRIX = {
  manageEvents: ["admin"],
  manageItems: ["admin"],
  manageSignups: ["admin"],
  manageUsers: ["admin"],
  viewAudit: ["admin"],
  viewVolunteerContacts: ["admin"],
  viewItems: ["admin", "cashier", "volunteer"],
  // Phase 2
  checkout: ["admin", "cashier"],
  lookupMembers: ["admin", "cashier"],
  viewTransactions: ["admin", "cashier"],
  /** Cashiers may void only their own sale, within VOID_WINDOW_MINUTES. */
  voidOwnRecent: ["admin", "cashier"],
  voidAny: ["admin"],
  refund: ["admin"],
  writeOff: ["admin"],
  settleIous: ["admin"],
  clearPayments: ["admin"],
  manageMembers: ["admin"],
  miscLine: ["admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof MATRIX;

export type Actor = { id: number; role: Role; name: string };

export function can(role: Role, permission: Permission): boolean {
  return (MATRIX[permission] as readonly Role[]).includes(role);
}

export function assertCan(actor: Actor, permission: Permission): void {
  if (!can(actor.role, permission)) throw new ForbiddenError();
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  cashier: "Cashier",
  volunteer: "Volunteer",
};
