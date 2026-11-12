/**
 * Money is always handled as integer cents. These helpers are the only place
 * dollars and cents are converted, so rounding mistakes can't creep in.
 */

/**
 * Parse what someone typed, or what a spreadsheet holds, into cents.
 * Accepts "5", "5.5", "$5.50", " $1,250.00 " and plain numbers.
 * Returns null for a blank value and undefined for something unreadable.
 */
export function parseDollarsToCents(input: unknown): number | null | undefined {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return undefined;
    return Math.round(input * 100);
  }
  const s = String(input).trim().replace(/[$,\s]/g, "");
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$|^\.\d{1,2}$/.test(s)) return undefined;
  const [whole, frac = ""] = s.split(".");
  return Number(whole || "0") * 100 + Number(frac.padEnd(2, "0"));
}

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** For pre-filling an input box: 550 becomes "5.50", null becomes "". */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
