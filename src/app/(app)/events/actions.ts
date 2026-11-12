"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import type { EventStatus } from "@/db/schema";
import { bool, run, str, type ActionState } from "@/lib/action";
import { requireUser } from "@/lib/auth";
import { UserError } from "@/lib/errors";
import { buildImportPreview, type ImportPreview, type QuantityChoice } from "@/lib/import/parse";
import { readSpreadsheet } from "@/lib/import/read-file";
import { createEvent, setEventStatus, updateEvent } from "@/lib/services/events";
import { applyImport, type ImportResult } from "@/lib/services/import";
import { createItem, deleteItem, renumberCodes, setItemActive, updateItem } from "@/lib/services/items";
import { addSignup, removeSignup, updateSignup } from "@/lib/services/signups";
import { createStation, deleteStation, updateStation } from "@/lib/services/stations";

// Every action re-checks who is signed in; the services check what they may do.

export async function createEventAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  let id: number | undefined;
  const state = await run(async () => {
    const copyFrom = str(fd, "copyFrom");
    const ev = await createEvent(getDb(), actor, { name: str(fd, "name"), saleDate: str(fd, "saleDate") }, copyFrom ? Number(copyFrom) : null);
    id = ev.id;
  });
  if (id) redirect(`/events/${id}`);
  return state;
}

export async function updateEventAction(eventId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    await updateEvent(getDb(), actor, eventId, { name: str(fd, "name"), saleDate: str(fd, "saleDate"), notes: str(fd, "notes") });
    return "Event details saved.";
  });
}

export async function setEventStatusAction(eventId: number, status: EventStatus, _prev: ActionState): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    await setEventStatus(getDb(), actor, eventId, status);
    return status === "open" ? "The sale is open. Item codes are now locked." : status === "closed" ? "Event closed." : "Saved.";
  });
}

// --- Stations ---------------------------------------------------------------

export async function createStationAction(eventId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    const s = await createStation(getDb(), actor, eventId, { name: str(fd, "name"), codePrefix: str(fd, "codePrefix") });
    return `Added ${s.name} (codes start with ${s.codePrefix}).`;
  });
}

export async function updateStationAction(stationId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    await updateStation(getDb(), actor, stationId, { name: str(fd, "name"), codePrefix: str(fd, "codePrefix") });
  });
}

export async function deleteStationAction(stationId: number, _prev: ActionState): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    await deleteStation(getDb(), actor, stationId);
    return "Station removed. Its items have no station now.";
  });
}

// --- Items ------------------------------------------------------------------

function itemFields(fd: FormData) {
  return {
    code: str(fd, "code"),
    name: str(fd, "name"),
    category: str(fd, "category"),
    unit: str(fd, "unit"),
    price: str(fd, "price"),
    expectedQty: str(fd, "expectedQty"),
    availableQty: str(fd, "availableQty"),
    stationId: str(fd, "stationId"),
    active: fd.has("activePresent") ? bool(fd, "active") : true,
  };
}

export async function createItemAction(eventId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    const it = await createItem(getDb(), actor, eventId, itemFields(fd));
    return `Added ${it.code} ${it.name}.`;
  });
}

export async function updateItemAction(itemId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    const it = await updateItem(getDb(), actor, itemId, itemFields(fd));
    return `Saved ${it.code} ${it.name}.`;
  });
}

export async function setItemActiveAction(itemId: number, active: boolean, _prev: ActionState): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    await setItemActive(getDb(), actor, itemId, active);
    return active ? "Item is active again." : "Item is now inactive and won't show at checkout.";
  });
}

export async function deleteItemAction(itemId: number, eventId: number, _prev: ActionState): Promise<ActionState> {
  const actor = await requireUser();
  let done = false;
  const state = await run(async () => {
    await deleteItem(getDb(), actor, itemId);
    done = true;
  });
  if (done) redirect(`/events/${eventId}/items`);
  return state;
}

export async function renumberCodesAction(eventId: number, _prev: ActionState): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    const { changed } = await renumberCodes(getDb(), actor, eventId);
    return changed ? `Renumbered ${changed} item codes.` : "Codes were already in order.";
  });
}

// --- Signups ----------------------------------------------------------------

export async function addSignupAction(itemId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    await addSignup(getDb(), actor, itemId, {
      volunteerName: str(fd, "volunteerName"),
      qty: str(fd, "qty"),
      allowLarge: bool(fd, "allowLarge"),
      note: str(fd, "note"),
    });
    return "Signup added.";
  });
}

export async function updateSignupAction(signupId: number, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    await updateSignup(getDb(), actor, signupId, { qty: str(fd, "qty"), allowLarge: bool(fd, "allowLarge"), note: str(fd, "note") });
  });
}

export async function removeSignupAction(signupId: number, _prev: ActionState): Promise<ActionState> {
  const actor = await requireUser();
  return run(async () => {
    await removeSignup(getDb(), actor, signupId);
    return "Signup removed.";
  });
}

// --- Import -----------------------------------------------------------------

export type PreviewState = { preview?: ImportPreview; fileName?: string; error?: string; result?: ImportResult } | null;

async function previewFrom(fd: FormData): Promise<{ preview: ImportPreview; fileName: string }> {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) throw new UserError("Choose a file first.");
  const sheets = await readSpreadsheet(file.name, await file.arrayBuffer());
  const preview = buildImportPreview(sheets);
  if (!preview.items.length) {
    throw new UserError("No items found. The file needs a column headed \"Item\" on at least one tab.");
  }
  return { preview, fileName: file.name };
}

/** Step 1: read the file and show what would be imported. Nothing is saved. */
export async function previewImportAction(_prev: PreviewState, fd: FormData): Promise<PreviewState> {
  await requireUser();
  try {
    return await previewFrom(fd);
  } catch (err) {
    if (err instanceof UserError) return { error: err.message };
    console.error(err);
    return { error: "That file couldn't be read. Is it an .xlsx or .csv file?" };
  }
}

/** Step 2: the same file is read again on the server and saved with the chosen options. */
export async function applyImportAction(eventId: number, _prev: PreviewState, fd: FormData): Promise<PreviewState> {
  const actor = await requireUser();
  let parsed: { preview: ImportPreview; fileName: string } | undefined;
  try {
    parsed = await previewFrom(fd);
    const q = str(fd, "quantity");
    let quantity: QuantityChoice;
    if (q === "larger" || q === "smaller" || q === "none") quantity = { kind: q };
    else if (q.startsWith("source:")) quantity = { kind: "source", source: q.slice("source:".length) };
    else throw new UserError("Pick which quantity to use for the expected amount.");
    const stationId = str(fd, "stationId");
    const result = await applyImport(getDb(), actor, eventId, parsed.preview, {
      quantity,
      stationId: stationId ? Number(stationId) : null,
      skipKeys: fd.getAll("skip").map(String),
      importVolunteers: bool(fd, "importVolunteers"),
    });
    return { ...parsed, result };
  } catch (err) {
    if (err instanceof UserError) return { ...parsed, error: err.message };
    console.error(err);
    return { ...parsed, error: "The import failed and nothing was saved. Please try again." };
  }
}
