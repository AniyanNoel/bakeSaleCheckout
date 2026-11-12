import "server-only";
import { refresh } from "next/cache";
import { UserError } from "./errors";

/** What every form action returns to the page. */
export type ActionState = { ok?: string; error?: string; at?: number } | null;

/**
 * Wraps a server action body: shows UserError messages to the person, hides
 * anything unexpected behind a generic message, and refreshes the page data.
 */
export async function run(fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const msg = await fn();
    refresh();
    return { ok: msg || "Saved.", at: Date.now() };
  } catch (err) {
    if (err instanceof UserError) return { error: err.message, at: Date.now() };
    // redirect() and notFound() work by throwing; let them through.
    if (err && typeof err === "object" && "digest" in err) throw err;
    console.error(err);
    return { error: "Something went wrong and nothing was saved. Please try again.", at: Date.now() };
  }
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

export function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}

export function intParam(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new UserError("That link doesn't look right.");
  return n;
}
