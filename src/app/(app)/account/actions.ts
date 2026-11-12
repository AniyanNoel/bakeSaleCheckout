"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { run, str, type ActionState } from "@/lib/action";
import { requireUser } from "@/lib/auth";
import { changeOwnPassword } from "@/lib/services/users";

export async function changePasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  if (str(fd, "next") !== str(fd, "next2")) return { error: "The two new passwords don't match." };
  const state = await run(async () => changeOwnPassword(getDb(), actor, str(fd, "current"), str(fd, "next")));
  // Changing a password signs out every session, including this one.
  if (state?.ok) redirect("/login");
  return state;
}
