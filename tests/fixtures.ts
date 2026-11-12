import type { Cell, SheetInput } from "@/lib/import/parse";

/**
 * Mirrors the layout of the 2025 "YF Bake Sale Sign Up" workbook: item names,
 * quantities and prices are as in that sheet. Volunteer names are made up
 * (the real sheet's volunteer columns were empty) and the IOU side table is blank.
 * The finance tab ends with a Total row and a small pizza pricing table, as in the real file.
 */
const SIGNUP_NOTE = "Expected Quantity is based off of last years bake sale.";

export function signupSheet(): SheetInput {
  const rows: Cell[][] = [
    ["Item", "Expected Quantity", "Volunteer 1", "Volunteer 2", "Volunteer 3", SIGNUP_NOTE],
    ["Achar (Pickle)", 2],
    ["Puffs", 30],
    ["Achappam", 30],
    ["Beef/Tuna/Chicken Cutlet", 50],
    ["Vattayappam", 25],
    ["Cupcakes", 25],
    ["Cookies (2 per bag)", 20],
    ["Brownies", 20],
    ["Pound Cake", 20],
    ["Soda", 32],
    ["Pizza (Pies)", 12, "Test Baker (3)", "Sample Helper", null, "Please use this format when signing up for pizza: Name (# of Pizzas)"],
    ["Kappa and Fish", 30],
    ["Kappa and Samandi", 20],
    ["Iddiappam", 30],
    ["Egg/Potato Curry", 30],
    ["Vadda (2) + Banana", 30],
    ["Ethakkappam", 30],
    ["inji curry", "TBD"],
  ];
  return { name: "2025 Sign Up", rows };
}

export function financeSheet(): SheetInput {
  const title = "Expected and Actual Income for March 2025 Bake Sale";
  const data: [string, number, string | null, string][] = [
    ["Achar (Pickle)", 2, "$10", "$20"],
    ["Puffs", 15, "$6", "$90"],
    ["Achappam", 10, "$5", "$50"],
    ["Beef/Tuna/Chicken Cutlet", 25, "$5", "$125"],
    ["Vattayappam", 25, null, "$25"],
    ["Cupcakes", 100, "$3", "$300"],
    ["Cookies (2 per bag)", 20, "$3", "$60"],
    ["Brownies", 20, "$3", "$60"],
    ["Pound Cake", 20, "$3", "$60"],
    ["Pizza (Pies)", 32, "$2", "$64"],
    ["2 Pizza Slice + 1 Soda Combo", 64, "$6", "$384"],
    ["Iddiappam", 30, "$15", "$450"],
    ["Kappa and Fish", 30, "$11", "$330"],
    ["Kappa and Samandi", 10, "$5", "$50"],
    ["Egg/Potato Curry", 30, "$0", "$0"],
    ["Vadda (2) + Banana", 30, "$10", "$300"],
    ["Ethakkappam", 30, "$4", "$120"],
    ["inji curry", "TBD" as unknown as number, null, ""],
  ];
  const rows: Cell[][] = [
    [title, title, title, title, title, title, null, null, "Name", "Account #", "Amount Owed", "Paid (Y or N)"],
    ["Item", "Quantity", "Unit Price", "Total Budgeted (if all sell)", "Actual Profit", "Notes", null, 1],
    ...data.map(([n, q, p, t], i) => [n, q, p, t, null, null, null, i + 2] as Cell[]),
    [null, null, null, null, null, null, null, 20],
    ["Total", null, null, "$2488", null, null, null, 22],
    [null],
    // A side table below the totals in the real sheet: not items.
    ["Pizza ", "Pricing"],
    ["1 slice", "3"],
    ["2 slices ", "5"],
    ["2 slices + can", "6"],
  ];
  return { name: "Finance", rows };
}
