"use server";

import { getDb } from "@/db";
import { run, str, type ActionState } from "@/lib/action";
import { requireUser } from "@/lib/auth";
import { UserError } from "@/lib/errors";
import { parseDirectory } from "@/lib/import/directory";
import { readSpreadsheet } from "@/lib/import/read-file";
import { createPerson, deletePerson, importDirectory, updatePerson } from "@/lib/services/members";

export async function createPersonAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    const p = await createPerson(getDb(), actor, { accountNumber: str(fd, "accountNumber"), name: str(fd, "name") });
    return `Added ${p.name} (#${p.accountNumber}).`;
  });
}

export async function updatePersonAction(id: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    await updatePerson(getDb(), actor, id, { accountNumber: str(fd, "accountNumber"), name: str(fd, "name") });
  });
}

export async function deletePersonAction(id: number, _prev: ActionState): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    await deletePerson(getDb(), actor, id);
  });
}

export async function importDirectoryAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserError("Choose a file first.");
    let parsed;
    try {
      parsed = parseDirectory(await readSpreadsheet(file.name, await file.arrayBuffer()));
    } catch (err) {
      throw new UserError(err instanceof Error ? err.message : "Couldn't read that file.");
    }
    const r = await importDirectory(getDb(), actor, parsed.rows);
    const parts = [`Added ${r.added}`, `updated ${r.updated} names`, `${r.unchanged} already there`];
    if (r.skipped.length) parts.push(`skipped ${r.skipped.length} (${r.skipped.slice(0, 3).join("; ")}${r.skipped.length > 3 ? "…" : ""})`);
    return parts.join(", ") + ".";
  });
}
