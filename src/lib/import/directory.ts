import type { Cell, SheetInput } from "./parse";
import type { DirectoryRow } from "../services/members";

function text(c: Cell): string {
  if (c === null || c === undefined) return "";
  if (typeof c === "number") return String(c);
  return String(c).trim();
}

/**
 * Reads the church directory from the first tab that has an account column and
 * a name column (or First name + Last name). Header names are matched loosely:
 * "Account", "Account #", "Acct No", "ID"; "Name", "Full name", "Family name".
 */
export function parseDirectory(sheets: SheetInput[]): { rows: DirectoryRow[]; sheet: string } {
  for (const sheet of sheets) {
    for (let h = 0; h < Math.min(sheet.rows.length, 10); h++) {
      const header = (sheet.rows[h] ?? []).map((c) => text(c).toLowerCase());
      const acct = header.findIndex((x) => /^(account|acct|id\b|member ?(id|#|no))/.test(x));
      const full = header.findIndex((x) => /^(full |family |member )?name$/.test(x));
      const first = header.findIndex((x) => /^first/.test(x));
      const last = header.findIndex((x) => /^last|^surname/.test(x));
      if (acct < 0 || (full < 0 && first < 0)) continue;
      const rows: DirectoryRow[] = [];
      for (const r of sheet.rows.slice(h + 1)) {
        if (!r) continue;
        const name = full >= 0 ? text(r[full]) : [text(r[first]), last >= 0 ? text(r[last]) : ""].filter(Boolean).join(" ");
        const accountNumber = text(r[acct]);
        if (!name && !accountNumber) continue;
        rows.push({ accountNumber, name });
      }
      return { rows, sheet: sheet.name };
    }
  }
  throw new Error('Couldn\'t find the columns. The file needs a header row with "Account" and "Name" (or "First name" and "Last name").');
}
