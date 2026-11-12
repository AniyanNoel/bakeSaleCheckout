"use server";

import { getDb } from "@/db";
import type { Role } from "@/db/schema";
import { run, str, type ActionState } from "@/lib/action";
import { requireUser } from "@/lib/auth";
import { createUser, resetPassword, updateUser } from "@/lib/services/users";

export async function createUserAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    const u = await createUser(getDb(), actor, { name: str(fd, "name"), email: str(fd, "email"), role: str(fd, "role"), password: str(fd, "password") });
    return `Created ${u.name}'s account. Give them their email and temporary password in person.`;
  });
}

export async function updateUserAction(userId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    await updateUser(getDb(), actor, userId, { role: str(fd, "role") as Role, active: str(fd, "active") === "yes" });
  });
}

export async function resetPasswordAction(userId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    await resetPassword(getDb(), actor, userId, str(fd, "password"));
    return "Password reset. They've been signed out everywhere.";
  });
}
