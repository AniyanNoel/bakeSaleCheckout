import { describe, expect, it } from "vitest";
import { formatCents, parseDollarsToCents, centsToInput } from "@/lib/money";
import { nextCode, nextStationPrefix, isValidCode, normalizeCode } from "@/lib/codes";
import { buildImportPreview, parseVolunteerCell, parseQuantity, pickQuantity } from "@/lib/import/parse";
import { readCsv } from "@/lib/import/read-file";
import { can } from "@/lib/permissions";
import { signupSheet, financeSheet } from "./fixtures";

describe("money", () => {
  it("parses dollars into integer cents", () => {
    expect(parseDollarsToCents("$5")).toBe(500);
    expect(parseDollarsToCents("5.5")).toBe(550);
    expect(parseDollarsToCents(" $1,250.05 ")).toBe(125005);
    expect(parseDollarsToCents(".75")).toBe(75);
    expect(parseDollarsToCents(0.1 + 0.2)).toBe(30);
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents(null)).toBeNull();
    expect(parseDollarsToCents("5.555")).toBeUndefined();
    expect(parseDollarsToCents("-3")).toBeUndefined();
    expect(parseDollarsToCents("abc")).toBeUndefined();
  });
  it("formats cents", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(-505)).toBe("-$5.05");
    expect(formatCents(null)).toBe("—");
    expect(centsToInput(550)).toBe("5.50");
  });
});

describe("item codes", () => {
  it("finds the next code per prefix", () => {
    expect(nextCode("A", [])).toBe("A01");
    expect(nextCode("A", ["A01", "A07", "B12"])).toBe("A08");
    expect(nextCode("B", ["A01", "A07", "B12"])).toBe("B13");
  });
  it("validates and normalises codes", () => {
    expect(normalizeCode(" a 01 ")).toBe("A01");
    expect(isValidCode("A01")).toBe(true);
    expect(isValidCode("AB123")).toBe(true);
    expect(isValidCode("1A")).toBe(false);
  });
  it("skips U when suggesting station letters", () => {
    expect(nextStationPrefix([])).toBe("A");
    const used = "ABCDEFGHIJKLMNOPQRST".split("");
    expect(nextStationPrefix(used)).toBe("V");
  });
});

describe("volunteer cells", () => {
  it("reads the 'Name (qty)' format the sheet asks for", () => {
    expect(parseVolunteerCell("Anna (3)")).toEqual({ raw: "Anna (3)", name: "Anna", qty: 3 });
    expect(parseVolunteerCell("Test Baker (2 pizzas)")?.qty).toBe(2);
    expect(parseVolunteerCell("Cara - 12")).toMatchObject({ name: "Cara", qty: 12 });
    expect(parseVolunteerCell("Dev x4")).toMatchObject({ name: "Dev", qty: 4 });
  });
  it("keeps a bare name with no quantity so it can be flagged", () => {
    expect(parseVolunteerCell("Elle")).toMatchObject({ name: "Elle", qty: null });
    expect(parseVolunteerCell("   ")).toBeNull();
  });
  it("reads quantities", () => {
    expect(parseQuantity(30)).toBe(30);
    expect(parseQuantity("30")).toBe(30);
    expect(parseQuantity("TBD")).toBeNull();
    expect(parseQuantity("")).toBeNull();
    expect(parseQuantity("lots")).toBeUndefined();
  });
});

describe("import preview from the 2025 layout", () => {
  const preview = buildImportPreview([signupSheet(), financeSheet()]);
  const byName = (n: string) => preview.items.find((i) => i.name === n)!;

  it("merges both tabs by item name", () => {
    expect(preview.sheetsRead).toEqual(["2025 Sign Up", "Finance"]);
    expect(preview.quantitySources).toEqual(["2025 Sign Up · Expected Quantity", "Finance · Quantity"]);
    // 18 on the sign-up tab, plus the combo that is only on the finance tab.
    // The Total row and the pizza pricing notes under it are not items.
    expect(preview.items).toHaveLength(19);
    expect(byName("Puffs").priceCents).toBe(600);
  });

  it("flags tabs that disagree instead of guessing", () => {
    expect(preview.hasQuantityConflicts).toBe(true);
    const cupcakes = byName("Cupcakes");
    expect(cupcakes.quantities).toEqual({ "2025 Sign Up · Expected Quantity": 25, "Finance · Quantity": 100 });
    expect(cupcakes.warnings.join(" ")).toMatch(/disagree/);
    expect(pickQuantity(cupcakes, { kind: "source", source: "Finance · Quantity" })).toBe(100);
    expect(pickQuantity(cupcakes, { kind: "larger" })).toBe(100);
    expect(pickQuantity(cupcakes, { kind: "smaller" })).toBe(25);
    expect(pickQuantity(cupcakes, { kind: "none" })).toBeNull();
  });

  it("flags missing and $0 prices", () => {
    expect(byName("Vattayappam").priceCents).toBeNull();
    expect(byName("Vattayappam").warnings).toContain("Price is blank.");
    expect(byName("Egg/Potato Curry").priceCents).toBe(0);
    expect(byName("Egg/Potato Curry").warnings).toContain("Price is $0.");
    expect(byName("Soda").warnings).toContain("No price column for this item.");
  });

  it("keeps TBD as unknown", () => {
    const inji = byName("inji curry");
    expect(inji.quantities["2025 Sign Up · Expected Quantity"]).toBeNull();
    expect(inji.warnings.join(" ")).toMatch(/TBD/);
  });

  it("parses volunteer columns and flags ones without a quantity", () => {
    const pizza = byName("Pizza (Pies)");
    expect(pizza.volunteers).toEqual([
      { raw: "Test Baker (3)", name: "Test Baker", qty: 3 },
      { raw: "Sample Helper", name: "Sample Helper", qty: null },
    ]);
    expect(pizza.warnings.join(" ")).toMatch(/no quantity/);
  });

  it("ignores the IOU side table on the finance tab", () => {
    expect(preview.items.some((i) => /name|account/i.test(i.name))).toBe(false);
  });

  it("reads a CSV export of a tab", () => {
    const sheet = readCsv("Items", "Item,Unit Price,Quantity\nBrownies,$3,20\n,,\nCookies,2.50,\n");
    const p = buildImportPreview([sheet]);
    expect(p.items.map((i) => [i.name, i.priceCents])).toEqual([["Brownies", 300], ["Cookies", 250]]);
  });
});

describe("permissions", () => {
  it("lets the signed-in cashier account do everything, and nothing else in", () => {
    expect(can("admin", "manageItems")).toBe(true);
    expect(can("admin", "checkout")).toBe(true);
    expect(can("cashier", "manageItems")).toBe(false);
  });
});

describe("reading an .xlsx download", () => {
  it("reads every tab, currency-formatted numbers and formula results", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { readSpreadsheet } = await import("@/lib/import/read-file");
    const wb = new ExcelJS.Workbook();
    const signup = wb.addWorksheet("2025 Sign Up");
    signupSheet().rows.forEach((r) => signup.addRow(r));
    const finance = wb.addWorksheet("Finance");
    finance.addRow(["Expected and Actual Income"]);
    finance.addRow(["Item", "Quantity", "Unit Price", "Total Budgeted"]);
    const row = finance.addRow(["Puffs", 15, 6]);
    row.getCell(3).numFmt = '"$"#,##0';
    finance.addRow(["Cupcakes", 100, 3, { formula: "B4*C4", result: 300 }]);
    finance.addRow(["inji curry", "TBD", null, { formula: "B5*C5", result: { error: "#VALUE!" } }]);
    finance.addRow(["Total", null, null, 390]);
    finance.addRow(["1 slice", 3]);
    const buf = await wb.xlsx.writeBuffer();
    const sheets = await readSpreadsheet("2025.xlsx", buf as ArrayBuffer);
    const p = buildImportPreview(sheets);
    expect(p.sheetsRead).toEqual(["2025 Sign Up", "Finance"]);
    expect(p.items.find((i) => i.name === "Puffs")?.priceCents).toBe(600);
    expect(p.items.find((i) => i.name === "Cupcakes")?.quantities["Finance · Quantity"]).toBe(100);
    expect(p.items.some((i) => i.name === "1 slice" || i.name === "Total")).toBe(false);
  });

  it("rejects other file types", async () => {
    const { readSpreadsheet } = await import("@/lib/import/read-file");
    await expect(readSpreadsheet("notes.pdf", new ArrayBuffer(4))).rejects.toThrow(/xlsx or .csv/);
  });
});
