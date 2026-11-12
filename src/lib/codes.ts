/**
 * Item codes look like A01, A02, B01: the station's letter(s) then a number.
 * Items without a station use UNASSIGNED_PREFIX until they are assigned.
 */
export const UNASSIGNED_PREFIX = "U";

const CODE_RE = /^([A-Z]{1,2})(\d{1,3})$/;

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function isValidCode(code: string): boolean {
  return CODE_RE.test(code);
}

export function formatCode(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(2, "0")}`;
}

/** Next free code for a prefix, given every code already used in the event. */
export function nextCode(prefix: string, existingCodes: Iterable<string>): string {
  let max = 0;
  for (const c of existingCodes) {
    const m = CODE_RE.exec(c);
    if (m && m[1] === prefix) max = Math.max(max, Number(m[2]));
  }
  return formatCode(prefix, max + 1);
}

/** Suggest the next unused station prefix: A, B, ... then AA, AB ... (U is reserved). */
export function nextStationPrefix(used: Iterable<string>): string {
  const taken = new Set(used);
  const letters = "ABCDEFGHIJKLMNOPQRSTVWXYZ";
  for (const l of letters) if (!taken.has(l)) return l;
  for (const a of letters) for (const b of letters) if (!taken.has(a + b)) return a + b;
  throw new Error("No station prefixes left");
}
