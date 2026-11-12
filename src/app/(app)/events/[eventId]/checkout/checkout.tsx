"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaymentMethod } from "@/db/schema";
import type { Catalog, CatalogItem } from "@/lib/services/catalog";
import { formatCents } from "@/lib/money";
import { deviceCache, outbox, sendSale, type OutboxEntry, type SentSale } from "@/lib/client/outbox";
import { Badge, buttonClass, cx, inputClass } from "@/components/ui";

type CartLine = { itemId: number; code: string; name: string; unitPriceCents: number; quantity: number };

const CART_KEY = "bake-sale-cart";
const METHODS: { id: PaymentMethod; label: string; key: string }[] = [
  { id: "cash", label: "Cash", key: "1" },
  { id: "venmo", label: "Venmo", key: "2" },
  { id: "check", label: "Check", key: "3" },
];

function normalizeAccount(s: string) {
  return s.trim().replace(/\s+/g, " ").toUpperCase();
}

function newId(): string {
  // randomUUID needs https; a laptop on plain http falls back to this.
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** "A01", "a1", "A1 3", "A01x3" -> code and quantity. */
function parseEntry(raw: string): { letters: string; num: number; qty: number } | null {
  const m = /^\s*([a-z]{1,2})\s*(\d{1,3})\s*(?:[x*]?\s*(\d{1,3}))?\s*$/i.exec(raw);
  if (!m) return null;
  return { letters: m[1].toUpperCase(), num: Number(m[2]), qty: m[3] ? Number(m[3]) : 1 };
}

/** "A1" and "A01" find the same item. */
function codeKey(code: string): string {
  const m = /^([A-Z]{1,2})0*(\d+)$/.exec(code.toUpperCase());
  return m ? `${m[1]}${m[2]}` : code.toUpperCase();
}

export function Checkout({ initial }: { initial: Catalog }) {
  const eventId = initial.event.id;
  const [catalog, setCatalog] = useState<Catalog>(initial);
  const [online, setOnline] = useState(true);
  const [account, setAccount] = useState("");
  const [name, setName] = useState("");
  const [knownName, setKnownName] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [entry, setEntry] = useState("");
  const [entryError, setEntryError] = useState<string | null>(null);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [paid, setPaid] = useState(true);
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [queue, setQueue] = useState<OutboxEntry[]>([]);
  const [recent, setRecent] = useState<SentSale[]>([]);
  const [signedOut, setSignedOut] = useState(false);
  const [restored, setRestored] = useState(false);
  const [showList, setShowList] = useState(false);
  const submitting = useRef(false);
  const flushing = useRef(false);
  const accountRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const entryRef = useRef<HTMLInputElement>(null);

  const byCode = useMemo(() => new Map(catalog.items.map((i) => [codeKey(i.code), i])), [catalog]);
  const nameByAccount = useMemo(() => new Map(catalog.people.map((p) => [p.accountNumber, p.name])), [catalog]);
  const total = cart.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);

  // ---- Item list: freshest copy we can get, with one kept on the device ----
  const refreshCatalog = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/catalog`, { cache: "no-store" });
      if (res.status === 401) return setSignedOut(true);
      if (!res.ok) return;
      const fresh = (await res.json()) as Catalog;
      setCatalog(fresh);
      await deviceCache.set(`catalog:${eventId}`, fresh);
    } catch {
      // Offline: keep using what we have.
    }
  }, [eventId]);

  useEffect(() => {
    (async () => {
      try {
        const cached = await deviceCache.get<Catalog>(`catalog:${eventId}`);
        if (cached?.people && cached.loadedAt > initial.loadedAt) setCatalog(cached);
        else await deviceCache.set(`catalog:${eventId}`, initial);
        setRecent((await deviceCache.get<SentSale[]>(`recent:${eventId}`)) ?? []);
      } catch {
        // Storage unavailable (private window): checkout still works while online.
      }
      try {
        const draft = JSON.parse(localStorage.getItem(CART_KEY) ?? "null");
        if (draft?.eventId === eventId) {
          setAccount(draft.account ?? "");
          setName(draft.name ?? "");
          setKnownName(draft.knownName ?? null);
          setCart(draft.cart ?? []);
          setMethod(draft.method ?? null);
          setPaid(draft.paid ?? true);
          setNote(draft.note ?? "");
        }
      } catch {
        // No draft.
      }
      setRestored(true);
    })();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then(() => navigator.serviceWorker.ready)
        .then((reg) => {
          // Save this page and its scripts so it opens even with no connection.
          const assets = performance
            .getEntriesByType("resource")
            .map((e) => new URL(e.name))
            .filter((u) => u.origin === location.origin && u.pathname.startsWith("/_next/static/"))
            .map((u) => u.pathname + u.search);
          reg.active?.postMessage({ type: "precache", urls: [location.pathname, ...assets] });
        })
        .catch(() => {});
    }
  }, [eventId, initial]);

  // Keep the unfinished checkout on the device so a reload doesn't lose it.
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(CART_KEY, JSON.stringify({ eventId, account, name, knownName, cart, method, paid, note }));
    } catch {
      // Storage blocked.
    }
  }, [restored, eventId, account, name, knownName, cart, method, paid, note]);

  // ---- Sending saved checkouts ----
  const reloadQueue = useCallback(async () => {
    try {
      setQueue((await outbox.all()).filter((e) => e.eventId === eventId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    } catch {
      setQueue([]);
    }
  }, [eventId]);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      const entries = (await outbox.all()).filter((e) => e.status !== "needs_attention");
      for (const e of entries) {
        await outbox.put({ ...e, status: "sending", attempts: e.attempts + 1 });
        await reloadQueue();
        const r = await sendSale(e);
        if (r.ok) {
          await outbox.remove(e.clientId);
          const list = [r.sale, ...((await deviceCache.get<SentSale[]>(`recent:${e.eventId}`)) ?? [])].slice(0, 10);
          await deviceCache.set(`recent:${e.eventId}`, list);
          if (e.eventId === eventId) setRecent(list);
          setOnline(true);
        } else {
          if (r.signedOut) setSignedOut(true);
          await outbox.put({ ...e, status: r.retry || r.signedOut ? "waiting" : "needs_attention", attempts: e.attempts + 1, lastError: r.error });
          if (r.retry) setOnline(false);
          if (r.retry || r.signedOut) break;
        }
      }
    } catch {
      // IndexedDB unavailable.
    } finally {
      flushing.current = false;
      await reloadQueue();
    }
  }, [eventId, reloadQueue]);

  useEffect(() => {
    const first = setTimeout(flush, 0);
    const goOnline = () => {
      setOnline(true);
      flush();
      refreshCatalog();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const timer = setInterval(() => flush(), 15_000);
    const catTimer = setInterval(() => refreshCatalog(), 60_000);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      clearTimeout(first);
      clearInterval(timer);
      clearInterval(catTimer);
    };
  }, [flush, refreshCatalog]);

  // ---- 1. Customer ----
  function onAccountEnter() {
    const acct = normalizeAccount(account);
    setAccount(acct);
    const found = acct ? nameByAccount.get(acct) : undefined;
    if (found) {
      setKnownName(found);
      setName("");
      entryRef.current?.focus();
    } else {
      setKnownName(null);
      nameRef.current?.focus();
    }
  }

  // ---- 2. Items ----
  function addItem(item: CatalogItem, qty: number) {
    if (item.priceCents === null) return setEntryError(`${item.code} ${item.name} has no price yet. Set it on the Items page.`);
    setEntryError(null);
    setCart((c) => {
      const i = c.findIndex((l) => l.itemId === item.id);
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, quantity: Math.min(999, l.quantity + qty) } : l));
      return [...c, { itemId: item.id, code: item.code, name: item.name, unitPriceCents: item.priceCents!, quantity: qty }];
    });
  }

  function onEntryEnter() {
    const raw = entry.trim();
    if (!raw) {
      if (cart.length) document.getElementById(`pay-${method ?? "cash"}`)?.focus();
      return;
    }
    const p = parseEntry(raw);
    if (!p) return setEntryError(`"${raw}" isn't a code. Type something like A1, or A1 3 for three.`);
    const item = byCode.get(`${p.letters}${p.num}`);
    if (!item) {
      const close = catalog.items.filter((i) => i.code.startsWith(p.letters)).slice(0, 6);
      return setEntryError(`No item ${p.letters}${p.num}.${close.length ? ` ${p.letters} items: ${close.map((c) => `${c.code} ${c.name}`).join(", ")}` : ""}`);
    }
    addItem(item, p.qty);
    setEntry("");
  }

  const setQty = (itemId: number, q: number) =>
    setCart((c) => (q <= 0 ? c.filter((l) => l.itemId !== itemId) : c.map((l) => (l.itemId === itemId ? { ...l, quantity: Math.min(999, q) } : l))));

  // ---- 3. Save ----
  function clearAll() {
    setAccount("");
    setName("");
    setKnownName(null);
    setCart([]);
    setEntry("");
    setEntryError(null);
    setMethod(null);
    setPaid(true);
    setNote("");
    setFormError(null);
    accountRef.current?.focus();
  }

  async function save() {
    if (submitting.current) return; // a double click or double Enter can't save twice
    setFormError(null);
    const acct = normalizeAccount(account);
    const customer = knownName ?? name.trim();
    if (!acct && !customer) return setFormError("Type an account number or a name.");
    if (acct && !knownName && !name.trim()) {
      nameRef.current?.focus();
      return setFormError(`Account ${acct} isn't in the list yet. Type their name.`);
    }
    if (!cart.length) return setFormError("Add at least one item.");
    if (paid && !method) return setFormError("Pick how they paid: Cash, Venmo or Check.");
    submitting.current = true;
    try {
      const clientId = newId();
      const payload = {
        clientId,
        eventId,
        accountNumber: acct || null,
        name: knownName ? null : name.trim(),
        lines: cart.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
        paymentMethod: method,
        paid,
        note: note.trim() || null,
        soldAt: new Date().toISOString(),
      };
      const e: OutboxEntry = {
        clientId,
        eventId,
        payload,
        createdAt: new Date().toISOString(),
        status: "waiting",
        attempts: 0,
        summary: { customer: acct ? `${customer} (#${acct})` : customer, totalCents: total, itemCount: cart.length, paid },
      };
      try {
        await outbox.put(e);
      } catch {
        // No device storage: send directly and only clear if it worked.
        const r = await sendSale(e);
        if (!r.ok) return setFormError(r.error);
        setRecent((list) => [r.sale, ...list].slice(0, 10));
        setLastSaved(`${e.summary.customer} · ${formatCents(total)} · ${paid ? "paid" : "not paid"}`);
        clearAll();
        return;
      }
      setLastSaved(`${e.summary.customer} · ${formatCents(total)} · ${paid ? `paid by ${method}` : "not paid yet"}`);
      clearAll();
      await reloadQueue();
      flush();
    } finally {
      submitting.current = false;
    }
  }

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
        ev.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function retry(e: OutboxEntry) {
    await outbox.put({ ...e, status: "waiting" });
    flush();
  }
  async function discard(e: OutboxEntry) {
    if (!confirm(`Delete this unsent checkout for ${e.summary.customer}? It was never saved.`)) return;
    await outbox.remove(e.clientId);
    reloadQueue();
  }

  const waiting = queue.filter((q) => q.status !== "needs_attention");
  const refused = queue.filter((q) => q.status === "needs_attention");
  const stations = useMemo(() => {
    const m = new Map<string, CatalogItem[]>();
    for (const i of catalog.items) {
      const k = i.station ?? "No table";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(i);
    }
    return [...m];
  }, [catalog]);

  const step = "rounded-lg border border-stone-200 bg-white p-4 shadow-sm";

  return (
    <div className="space-y-4">
      {/* Status */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={online ? "green" : "red"}>{online ? "Online" : "Offline: checkouts are kept on this computer"}</Badge>
        {waiting.length > 0 && (
          <Badge tone="amber">
            {waiting.length} checkout{waiting.length === 1 ? "" : "s"} waiting to send
          </Badge>
        )}
        <span className="text-stone-500">{catalog.items.length} items · {catalog.people.length} people</span>
      </div>
      {signedOut && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          You&apos;ve been signed out. Unsent checkouts are safe on this computer.{" "}
          <a href="/login" target="_blank" className="font-semibold underline">
            Sign in again in a new tab
          </a>
          , then come back here.
        </div>
      )}
      {refused.map((e) => (
        <div key={e.clientId} role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <strong>Not saved:</strong> {e.summary.customer}, {formatCents(e.summary.totalCents)}. {e.lastError}
          <div className="mt-2 flex gap-2">
            <button className={buttonClass.small} onClick={() => retry(e)}>
              Try again
            </button>
            <button className={buttonClass.small} onClick={() => discard(e)}>
              Delete it
            </button>
          </div>
        </div>
      ))}
      {lastSaved && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Saved: {lastSaved}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {/* 1. Customer */}
          <section className={step}>
            <h2 className="mb-3 font-semibold">1. Customer</h2>
            <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
              <label className="text-sm">
                <span className="mb-1 block font-medium text-stone-700">Account #</span>
                <input
                  id="acct"
                  ref={accountRef}
                  className={cx(inputClass, "font-mono text-lg")}
                  value={account}
                  autoFocus
                  autoComplete="off"
                  onChange={(e) => {
                    setAccount(e.target.value);
                    setKnownName(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onAccountEnter();
                    }
                  }}
                  onBlur={() => {
                    const acct = normalizeAccount(account);
                    if (acct && nameByAccount.has(acct)) setKnownName(nameByAccount.get(acct)!);
                  }}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-stone-700">Name</span>
                {knownName ? (
                  <div className="flex h-11 items-center gap-2 text-lg font-semibold" data-testid="known-name">
                    {knownName}
                    <span className="text-xs font-normal text-green-700">in the list</span>
                  </div>
                ) : (
                  <input
                    id="name"
                    ref={nameRef}
                    className={cx(inputClass, "text-lg")}
                    value={name}
                    placeholder={normalizeAccount(account) ? "New account: type their name" : "Name (if no account number)"}
                    autoComplete="off"
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        entryRef.current?.focus();
                      }
                    }}
                  />
                )}
              </label>
            </div>
            {!knownName && normalizeAccount(account) && name.trim() && (
              <p className="mt-2 text-xs text-stone-500">Account {normalizeAccount(account)} will be added to the People list.</p>
            )}
          </section>

          {/* 2. Items */}
          <section className={step}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">2. Item codes</h2>
              <button type="button" className="text-sm text-amber-800 underline" onClick={() => setShowList((s) => !s)}>
                {showList ? "Hide item list" : "Show item list"}
              </button>
            </div>
            <input
              id="code"
              ref={entryRef}
              aria-label="Item code"
              className={cx(inputClass, "font-mono text-lg uppercase")}
              placeholder="A1  or  A1 3  for three. Empty Enter when done."
              value={entry}
              autoComplete="off"
              onChange={(e) => setEntry(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onEntryEnter();
                }
              }}
            />
            {entryError && (
              <p role="alert" className="mt-2 text-sm font-medium text-red-700">
                {entryError}
              </p>
            )}
            {cart.length > 0 && (
              <table className="mt-3 w-full text-sm">
                <tbody className="divide-y divide-stone-100">
                  {cart.map((l) => (
                    <tr key={l.itemId}>
                      <td className="py-1.5 font-mono text-stone-500">{l.code}</td>
                      <td className="py-1.5">{l.name}</td>
                      <td className="py-1.5 text-right tabular-nums text-stone-500">{formatCents(l.unitPriceCents)}</td>
                      <td className="py-1.5">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" tabIndex={-1} className={buttonClass.small} aria-label={`One less ${l.name}`} onClick={() => setQty(l.itemId, l.quantity - 1)}>
                            −
                          </button>
                          <span className="w-8 text-center tabular-nums">{l.quantity}</span>
                          <button type="button" tabIndex={-1} className={buttonClass.small} aria-label={`One more ${l.name}`} onClick={() => setQty(l.itemId, l.quantity + 1)}>
                            +
                          </button>
                        </div>
                      </td>
                      <td className="py-1.5 text-right font-medium tabular-nums">{formatCents(l.unitPriceCents * l.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {showList && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {stations.map(([station, list]) => (
                  <div key={station}>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{station}</div>
                    <div className="flex flex-wrap gap-1">
                      {list.map((i) => (
                        <button
                          key={i.id}
                          type="button"
                          tabIndex={-1}
                          className="rounded border border-stone-200 px-2 py-1 text-left text-xs hover:bg-amber-50 disabled:opacity-50"
                          disabled={i.priceCents === null}
                          onClick={() => addItem(i, 1)}
                        >
                          <span className="font-mono font-semibold">{i.code}</span> {i.name} <span className="text-stone-500">{i.priceCents === null ? "no price" : formatCents(i.priceCents)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 3. Payment */}
          <section className={step}>
            <h2 className="mb-3 font-semibold">3. Payment</h2>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Form of payment">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  id={`pay-${m.id}`}
                  type="button"
                  role="radio"
                  aria-checked={method === m.id}
                  className={cx(
                    "h-11 rounded-md border px-5 font-medium",
                    method === m.id ? "border-amber-600 bg-amber-600 text-white" : "border-stone-300 bg-white hover:bg-stone-50",
                  )}
                  onClick={() => {
                    setMethod(m.id);
                    document.getElementById("save")?.focus();
                  }}
                  onKeyDown={(e) => {
                    // Arrow keys move between Cash, Venmo and Check; 1, 2, 3 pick one directly.
                    const i = METHODS.findIndex((x) => x.id === m.id);
                    const pick = METHODS.find((x) => x.key === e.key);
                    if (pick) {
                      e.preventDefault();
                      setMethod(pick.id);
                      document.getElementById("save")?.focus();
                    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                      e.preventDefault();
                      const next = METHODS[(i + (e.key === "ArrowRight" ? 1 : METHODS.length - 1)) % METHODS.length];
                      document.getElementById(`pay-${next.id}`)?.focus();
                    }
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-4 text-sm" role="radiogroup" aria-label="Paid">
              <span className="font-medium text-stone-700">Paid?</span>
              <label className="flex items-center gap-2">
                <input type="radio" name="paid" checked={paid} onChange={() => setPaid(true)} className="h-4 w-4" />
                Yes, paid now
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="paid" checked={!paid} onChange={() => setPaid(false)} className="h-4 w-4" />
                No, will pay later
              </label>
            </div>
            <input
              className={cx(inputClass, "mt-3")}
              placeholder="Note (optional), e.g. Venmo name or check number"
              aria-label="Note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </section>
        </div>

        {/* Total and save */}
        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className={step}>
            <div className="text-xs font-medium uppercase tracking-wide text-stone-500">Total</div>
            <div className="text-4xl font-bold tabular-nums" data-testid="cart-total">
              {formatCents(total)}
            </div>
            <div className="mt-1 text-sm text-stone-600">
              {knownName ?? (name.trim() || "No customer yet")}
              {normalizeAccount(account) && <span className="font-mono"> · #{normalizeAccount(account)}</span>}
            </div>
            <div className="text-sm text-stone-600">
              {method ? METHODS.find((m) => m.id === method)!.label : "No payment picked"} · {paid ? "Paid" : "Not paid yet"}
            </div>
            {formError && (
              <p role="alert" className="mt-3 text-sm font-medium text-red-700">
                {formError}
              </p>
            )}
            <button id="save" type="button" className={cx(buttonClass.primary, "mt-4 h-12 w-full text-base")} onClick={save}>
              Save checkout
            </button>
            <p className="mt-2 text-center text-xs text-stone-500">or press Ctrl+Enter</p>
            <button type="button" className="mt-2 w-full text-sm text-stone-500 underline" onClick={clearAll}>
              Clear and start over
            </button>
          </div>

          <div className={step}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Recent</h2>
              <Link href={`/events/${eventId}/records`} className="text-sm text-amber-800 underline">
                All records
              </Link>
            </div>
            {queue.length === 0 && recent.length === 0 && <p className="text-sm text-stone-400">Nothing yet.</p>}
            <ul className="divide-y divide-stone-100 text-sm">
              {waiting.map((q) => (
                <li key={q.clientId} className="flex flex-wrap items-center gap-2 py-1.5">
                  <Badge tone="amber">{q.status === "sending" ? "Sending…" : "Waiting to send"}</Badge>
                  <span>{q.summary.customer}</span>
                  <span className="tabular-nums text-stone-600">{formatCents(q.summary.totalCents)}</span>
                </li>
              ))}
              {recent.map((r) => (
                <li key={r.clientId} className="flex flex-wrap items-center gap-2 py-1.5">
                  <Badge tone="green">Saved</Badge>
                  <span>
                    {r.customerName}
                    {r.accountNumber && <span className="font-mono text-stone-500"> #{r.accountNumber}</span>}
                  </span>
                  <span className="tabular-nums text-stone-600">{formatCents(r.totalCents)}</span>
                  {!r.paid && <Badge tone="amber">Not paid</Badge>}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
