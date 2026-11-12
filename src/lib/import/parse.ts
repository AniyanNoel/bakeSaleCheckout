/**
 * Turns last year's spreadsheet into a list of items the admin can review
 * before anything is saved. Pure functions only: no database, no files.
 *
 * Built around the 2025 "YF Bake Sale Sign Up" layout:
 *  - a sign-up tab with Item, Expected Quantity, Volunteer 1..3
 *  - a finance tab with a title row, then Item, Quantity, Unit Price, ...
 * but any tab with an "Item" header column is read the same way.
 */
import { parseDollarsToCents } from "../money";

export type Cell = string | number | boolean | Date | null | undefined;
export type SheetInput = { name: string; rows: Cell[][] };

export type ParsedVolunteer = { raw: string; name: string; qty: number | null };

export type ImportItem = {
  key: string;
  name: string;
  priceCents: number | null;
  /** Each quantity column that mentioned this item, keyed by source label. */
  quantities: Record<string, number | null>;
  volunteers: ParsedVolunteer[];
  warnings: string[];
};

export type ImportPreview = {
  /** Labels like "2025 Sign Up · Expected Quantity", in sheet order. */
  quantitySources: string[];
  items: ImportItem[];
  sheetsRead: string[];
  sheetsIgnored: string[];
  /** True when at least one item has different numbers in different columns. */
  hasQuantityConflicts: boolean;
};

type ColumnMap = {
  item: number;
  price?: number;
  qty: { col: number; label: string }[];
  volunteers: number[];
};

const HEADER_SCAN_ROWS = 10;
const TOTAL_ROW = /^(grand )?totals?:?$/i;

export function cellText(c: Cell): string {
  if (c === null || c === undefined) return "";
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  return String(c).trim();
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** "TBD", "", "-" give null; "30" or 30 gives 30; anything else gives undefined. */
export function parseQuantity(c: Cell): number | null | undefined {
  if (typeof c === "number") return Number.isInteger(c) && c >= 0 ? c : undefined;
  const s = cellText(c);
  if (s === "" || s === "-" || /^tbd$/i.test(s) || /^n\/?a$/i.test(s)) return null;
  if (/^\d+$/.test(s)) return Number(s);
  return undefined;
}

/**
 * Volunteer cells are free text. The sheet asked for "Name (# of Pizzas)".
 * Handles "Anna (3)", "Anna (3 pizzas)", "Anna - 3", "Anna x3", "Anna: 3".
 * A bare name is kept with qty null so the admin can fill it in.
 */
export function parseVolunteerCell(raw: string): ParsedVolunteer | null {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) return null;
  const patterns = [
    /^(.+?)\s*\(\s*(\d+)[^)]*\)\s*$/, // Anna (3) / Anna (3 pizzas)
    /^(.+?)\s*[-–:]\s*(\d+)\s*$/, // Anna - 3 / Anna: 3
    /^(.+?)\s+x\s*(\d+)\s*$/i, // Anna x3
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const qty = Number(m[2]);
      return { raw, name: m[1].trim(), qty: qty >= 1 ? qty : null };
    }
  }
  return { raw, name: text, qty: null };
}

function findColumns(rows: Cell[][]): { headerRow: number; map: ColumnMap } | null {
  for (let r = 0; r < Math.min(rows.length, HEADER_SCAN_ROWS); r++) {
    const headers = (rows[r] ?? []).map((c) => cellText(c).toLowerCase());
    const item = headers.findIndex((h) => h === "item" || h === "item name" || h === "items");
    if (item === -1) continue;
    const map: ColumnMap = { item, qty: [], volunteers: [] };
    headers.forEach((h, i) => {
      if (i === item || !h) return;
      if (/^volunteer/.test(h)) map.volunteers.push(i);
      else if (/unit price|^price$/.test(h) && map.price === undefined) map.price = i;
      else if (/^(expected )?quantity$|^qty$|^expected qty$/.test(h)) {
        map.qty.push({ col: i, label: cellText(rows[r][i]) });
      }
    });
    // Only a real header if it has something besides the item column.
    if (map.price !== undefined || map.qty.length || map.volunteers.length) {
      return { headerRow: r, map };
    }
  }
  return null;
}

export function buildImportPreview(sheets: SheetInput[]): ImportPreview {
  const byKey = new Map<string, ImportItem>();
  const prices = new Map<string, Set<number | null>>();
  const quantitySources: string[] = [];
  const sheetsRead: string[] = [];
  const sheetsIgnored: string[] = [];

  for (const sheet of sheets) {
    const found = findColumns(sheet.rows);
    if (!found) {
      sheetsIgnored.push(sheet.name);
      continue;
    }
    sheetsRead.push(sheet.name);
    const { headerRow, map } = found;
    const qtyCols = map.qty.map((q) => ({ ...q, source: `${sheet.name} · ${q.label}` }));
    for (const q of qtyCols) if (!quantitySources.includes(q.source)) quantitySources.push(q.source);

    for (let r = headerRow + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r] ?? [];
      const name = cellText(row[map.item]).replace(/\s+/g, " ");
      if (!name) continue;
      // A "Total" row ends the table; anything below it (like the 2025 pizza
      // pricing notes) is a separate side table, not items.
      if (TOTAL_ROW.test(name)) break;
      const key = normalizeName(name);
      let item = byKey.get(key);
      if (!item) {
        item = { key, name, priceCents: null, quantities: {}, volunteers: [], warnings: [] };
        byKey.set(key, item);
      }

      for (const q of qtyCols) {
        const parsed = parseQuantity(row[q.col]);
        if (parsed === undefined) {
          item.warnings.push(`"${cellText(row[q.col])}" in ${q.source} is not a whole number, so it was skipped.`);
          item.quantities[q.source] = null;
        } else {
          item.quantities[q.source] = parsed;
          if (parsed === null && cellText(row[q.col])) {
            item.warnings.push(`${q.source} says "${cellText(row[q.col])}".`);
          }
        }
      }

      if (map.price !== undefined) {
        const raw = row[map.price];
        const cents = parseDollarsToCents(raw);
        if (cents === undefined) {
          item.warnings.push(`Price "${cellText(raw)}" could not be read.`);
        } else {
          if (!prices.has(key)) prices.set(key, new Set());
          prices.get(key)!.add(cents);
          if (item.priceCents === null && cents !== null) item.priceCents = cents;
        }
      }

      for (const col of map.volunteers) {
        const v = parseVolunteerCell(cellText(row[col]));
        if (!v) continue;
        item.volunteers.push(v);
        if (v.qty === null) {
          item.warnings.push(`Volunteer "${v.raw}" has no quantity in brackets; add it after importing.`);
        }
      }
    }
  }

  let hasQuantityConflicts = false;
  const items = [...byKey.values()];
  for (const item of items) {
    const seenPrices = prices.get(item.key);
    if (!seenPrices) {
      item.warnings.push("No price column for this item.");
    } else if (item.priceCents === null) {
      item.warnings.push("Price is blank.");
    } else if (item.priceCents === 0) {
      item.warnings.push("Price is $0.");
    }
    if (seenPrices && [...seenPrices].filter((p) => p !== null).length > 1) {
      item.warnings.push("Different prices on different tabs; the first one was used.");
    }

    const values = Object.values(item.quantities).filter((q): q is number => q !== null);
    if (new Set(values).size > 1) {
      hasQuantityConflicts = true;
      item.warnings.push(
        `Quantities disagree: ${Object.entries(item.quantities)
          .map(([s, q]) => `${q ?? "blank"} (${s})`)
          .join(" vs ")}.`,
      );
    }
    const missingFrom = quantitySources.filter((s) => !(s in item.quantities));
    if (quantitySources.length > 1 && missingFrom.length) {
      item.warnings.push(`Only listed on some tabs (missing from ${missingFrom.join(", ")}).`);
    }
  }

  return { quantitySources, items, sheetsRead, sheetsIgnored, hasQuantityConflicts };
}

export type QuantityChoice = { kind: "source"; source: string } | { kind: "larger" } | { kind: "smaller" } | { kind: "none" };

/** The expected quantity an item gets, given the admin's choice. */
export function pickQuantity(item: ImportItem, choice: QuantityChoice): number | null {
  const values = Object.values(item.quantities).filter((q): q is number => q !== null);
  switch (choice.kind) {
    case "none":
      return null;
    case "larger":
      return values.length ? Math.max(...values) : null;
    case "smaller":
      return values.length ? Math.min(...values) : null;
    case "source": {
      const q = item.quantities[choice.source];
      return q === undefined ? null : q;
    }
  }
}
