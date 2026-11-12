import ExcelJS from "exceljs";
import Papa from "papaparse";
import type { Cell, SheetInput } from "./parse";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * Reads an uploaded .xlsx workbook (every tab) or a single .csv file.
 * In Google Sheets: File > Download > Microsoft Excel (.xlsx) gets every tab at once.
 */
export async function readSpreadsheet(fileName: string, data: ArrayBuffer): Promise<SheetInput[]> {
  if (data.byteLength > MAX_IMPORT_BYTES) throw new Error("That file is over 5 MB, which is too big for an item list.");
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return [readCsv(fileName.replace(/\.csv$/i, ""), new TextDecoder().decode(data))];
  if (lower.endsWith(".xlsx")) return readXlsx(data);
  throw new Error("Please upload an .xlsx or .csv file.");
}

export function readCsv(name: string, text: string): SheetInput {
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: false });
  return { name, rows: result.data };
}

async function readXlsx(data: ArrayBuffer): Promise<SheetInput[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const sheets: SheetInput[] = [];
  wb.eachSheet((ws) => {
    const rows: Cell[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const values: Cell[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        values[col - 1] = cellValue(cell.value);
      });
      rows[rowNumber - 1] = values;
    });
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    sheets.push({ name: ws.name, rows });
  });
  return sheets;
}

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v instanceof Date) return v;
  if (typeof v === "object") {
    if ("formula" in v || "sharedFormula" in v || "result" in v) {
      // A formula: use its last calculated value (an error result becomes blank).
      return cellValue(("result" in v ? v.result : null) as ExcelJS.CellValue);
    }
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text); // hyperlink
    if ("error" in v) return null;
  }
  return String(v);
}
