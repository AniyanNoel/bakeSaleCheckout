"use client";

/**
 * The checkout outbox. Every completed sale is written here first (IndexedDB,
 * which survives closing the tab or restarting the laptop), then sent to the
 * server. A sale leaves the outbox only once the server confirms it.
 */

export type OutboxStatus = "sending" | "waiting" | "needs_attention";

export type OutboxEntry = {
  clientId: string;
  eventId: number;
  payload: unknown;
  createdAt: string;
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  summary: { customer: string; totalCents: number; itemCount: number; paid: boolean };
};

export type SentSale = {
  clientId: string;
  id: number;
  customerName: string;
  accountNumber: string | null;
  totalCents: number;
  paid: boolean;
  sentAt: string;
};

const DB_NAME = "bake-sale";
const STORE = "outbox";
const CACHE = "cache";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "clientId" });
      if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => {
      resolve(req.result);
      db.close();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const outbox = {
  put: (e: OutboxEntry) => run(STORE, "readwrite", (s) => s.put(e)),
  remove: (clientId: string) => run(STORE, "readwrite", (s) => s.delete(clientId)),
  all: () => run<OutboxEntry[]>(STORE, "readonly", (s) => s.getAll() as IDBRequest<OutboxEntry[]>),
};

/** A small key-value cache for the catalog and recent sales. */
export const deviceCache = {
  get: <T>(key: string) => run<T | undefined>(CACHE, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>),
  set: (key: string, value: unknown) => run(CACHE, "readwrite", (s) => s.put(value, key)),
  clear: () => run(CACHE, "readwrite", (s) => s.clear()),
};

/** Remove cached names from this device (on sign-out). Unsent sales stay. */
export async function clearDeviceCache(): Promise<void> {
  try {
    await deviceCache.clear();
    localStorage.removeItem("bake-sale-cart");
  } catch {
    // Nothing cached, or storage blocked: nothing to clear.
  }
}

export type SendResult = { ok: true; sale: SentSale } | { ok: false; retry: boolean; error: string; signedOut?: boolean };

/** Send one sale. "retry" means a network or server problem; otherwise a person must look at it. */
export async function sendSale(entry: OutboxEntry): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch("/api/checkouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry.payload),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, retry: true, error: "No connection. Will send when the Wi-Fi is back." };
  }
  let body: { error?: string; id?: number; customerName?: string; accountNumber?: string | null; totalCents?: number; paid?: boolean } = {};
  try {
    body = await res.json();
  } catch {
    // Non-JSON reply (for example a captive Wi-Fi login page).
    return { ok: false, retry: true, error: "The connection isn't reaching the server yet." };
  }
  if (res.ok && body.id) {
    return {
      ok: true,
      sale: {
        clientId: entry.clientId,
        id: body.id,
        customerName: body.customerName ?? entry.summary.customer,
        accountNumber: body.accountNumber ?? null,
        totalCents: body.totalCents ?? entry.summary.totalCents,
        paid: body.paid ?? entry.summary.paid,
        sentAt: new Date().toISOString(),
      },
    };
  }
  if (res.status === 401) return { ok: false, retry: false, signedOut: true, error: body.error ?? "Signed out." };
  if (res.status >= 500) return { ok: false, retry: true, error: body.error ?? "Server problem. Will try again." };
  return { ok: false, retry: false, error: body.error ?? `The server refused this checkout (${res.status}).` };
}
