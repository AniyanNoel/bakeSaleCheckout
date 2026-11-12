import type { z } from "zod";
import { UserError } from "./errors";

/** Validate input with a zod schema, turning the first problem into a readable error. */
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new UserError(r.error.issues[0]?.message ?? "Please check the form.");
  return r.data;
}
