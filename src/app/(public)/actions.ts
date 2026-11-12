"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { str, type ActionState } from "@/lib/action";
import { endSession, startSession } from "@/lib/auth";
import { UserError } from "@/lib/errors";
import { createFirstAdmin, verifyLogin } from "@/lib/services/users";

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let userId: number;
  try {
    const u = await verifyLogin(getDb(), str(fd, "email"), str(fd, "password"));
    userId = u.id;
  } catch (err) {
    if (err instanceof UserError) return { error: err.message };
    console.error(err);
    return { error: "Couldn't sign in just now. Check the connection and try again." };
  }
  await startSession(userId);
  redirect("/events");
}

export async function setupAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  if (str(fd, "password") !== str(fd, "password2")) return { error: "The two passwords don't match." };
  let userId: number;
  try {
    const u = await createFirstAdmin(getDb(), { name: str(fd, "name"), email: str(fd, "email"), password: str(fd, "password") });
    userId = u.id;
  } catch (err) {
    if (err instanceof UserError) return { error: err.message };
    console.error(err);
    return { error: "Setup failed. Please try again." };
  }
  await startSession(userId);
  redirect("/events");
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}
