"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaymentMethod } from "@/db/schema";
import type { Catalog, CatalogItem } from "@/lib/services/catalog";
import type { MemberSummary } from "@/lib/services/members";
import { formatCents, parseDollarsToCents, centsToInput } from "@/lib/money";
import { computeSale, type Overpay } from "@/lib/sale-math";
import { deviceCache, outbox, sendSale, type OutboxEntry, type SentSale } from "@/lib/client/outbox";
import { Badge, buttonClass, cx, inputClass } from "@/components/ui";

type Customer =
  | { kind: "member"; member: MemberSummary }
  | { kind: "new_member"; accountNumber: string; name: string }
  | { kind: "walk_up"; name: string };

type CartLine = { itemId: number; code: string; name: string; unitPriceCents: number; quantity: number; warn?: string };
type PayRow = { key: number; method: PaymentMethod; amount: string; reference: string };

const CART_KEY = "bake-sale-cart";
const METHOD_LABEL: Record<PaymentMethod, string> = { cash: "Cash", venmo: "Venmo", check: "Check" };

function normalizeAccount(s: string) {
  return s.trim().replace(/\s+/g, " ").toUpperCase();
}

function newId(): string {
  // randomUUID needs https; older tablets on plain http fall back to this.
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function deviceId(): string {
  try {
    let id = localStorage.getItem("bake-sale-device");
    if (!id) {
      id = newId();
      localStorage.setItem("bake-sale-device", id);
    }
    return id;
  } catch {
    return "unknown";
  }
}

/** "A01", "a01 3", "A01x3", "A01*3" -> code and quantity. */
function parseEntry(raw: string): { code: string; qty: number } | null {
  const m = /^\s*([a-z]{1,2})\s*0*(\d{1,3})\s*(?:[x*]?\s*(\d{1,3}))?\s*$/i.exec(raw);
  if (!m) return null;
  return { code: `${m[1].toUpperCase()}${m[2].padStart(2, "0")}`, qty: m[3] ? Number(m[3]) : 1 };
}

export function Checkout({ initial, isAdmin, userName }: { initial: Catalog; isAdmin: boolean; userName: string }) {
  const eventId = initial.event.id;
  const [catalog, setCatalog] = useState<Catalog>(initial);
  const [online, setOnline] = useState(true);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [account, setAccount] = useState("");
  const [newName, setNewName] = useState("");
  const [nameSearch, setNameSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [entry, setEntry] = useState("");
  const [entryError, setEntryError] = useState<string | null>(null);
  const [pays, setPays] = useState<PayRow[]>([]);
  const [overpay, setOverpay] = useState<Overpay>("change");
  const [formError, setFormError] = useState<string | null>(null);
  const [queue, setQueue] = useState<OutboxEntry[]>([]);
  const [recent, setRecent] = useState<SentSale[]>([]);
  const [signedOut, setSignedOut] = useState(false);
  const [restored, setRestored] = useState(false);
  const submitting = useRef(false);
  const flushing = useRef(false);
  const payKey = useRef(1);
  const accountRef = useRef<HTMLInputElement>(null);
  const entryRef = useRef<HTMLInputElement>(null);
  const completeRef = useRef<HTMLButtonElement>(null);

  const byCode = useMemo(() => new Map(catalog.items.map((i) => [i.code, i])), [catalog]);
  const memberByAccount = useMemo(() => new Map(catalog.members.map((m) => [m.accountNumber, m])), [catalog]);

  // ---- Catalog: use the freshest copy we can get, keep one on the device ----
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
        // The page itself may have come from the offline copy, so prefer the newer one.
        if (cached && cached.loadedAt > initial.loadedAt) setCatalog(cached);
        else await deviceCache.set(`catalog:${eventId}`, initial);
        setRecent((await deviceCache.get<SentSale[]>(`recent:${eventId}`)) ?? []);
      } catch {
        // Storage unavailable (private window): checkout still works while online.
      }
      try {
        const draft = JSON.parse(localStorage.getItem(CART_KEY) ?? "null");
        if (draft?.eventId === eventId) {
          setCustomer(draft.customer ?? null);
          setCart(draft.cart ?? []);
          setPays(draft.pays ?? []);
          setOverpay(draft.overpay ?? "change");
          if (draft.customer?.kind === "member") setAccount(draft.customer.member.accountNumber);
          if (draft.customer?.kind === "new_member") {
            setAccount(draft.customer.accountNumber);
            setNewName(draft.customer.name);
          }
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
          // Save this page and the scripts it loaded, for opening it offline later.
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

  // Keep the unfinished cart on the device so a crash or reload doesn't lose it.
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(CART_KEY, JSON.stringify({ eventId, customer, cart, pays, overpay }));
    } catch {
      // Storage blocked.
    }
  }, [restored, eventId, customer, cart, pays, overpay]);

  // ---- Outbox sync ----
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
          const list = [r.sale, ...((await deviceCache.get<SentSale[]>(`recent:${e.eventId}`)) ?? [])].slice(0, 15);
          await deviceCache.set(`recent:${e.eventId}`, list);
          if (e.eventId === eventId) setRecent(list);
          setOnline(true);
        } else {
          if (r.signedOut) setSignedOut(true);
          await outbox.put({ ...e, status: r.retry || r.signedOut ? "waiting" : "needs_attention", attempts: e.attempts + 1, lastError: r.error });
          if (r.retry) setOnline(false);
          if (r.retry || r.signedOut) break; // no point trying the rest right now
        }
      }
    } catch {
      // IndexedDB unavailable; nothing to send.
    } finally {
      flushing.current = false;
      await reloadQueue();
    }
  }, [eventId, reloadQueue]);

  useEffect(() => {
    const first = setTimeout(flush, 0); // also loads the queue for display
    const goOnline = () => {
      setOnline(true);
      flush();
      refreshCatalog();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const timer = setInterval(() => flush(), 15_000);
    const catTimer = setInterval(() => refreshCatalog(), 120_000);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      clearTimeout(first);
      clearInterval(timer);
      clearInterval(catTimer);
    };
  }, [flush, reloadQueue, refreshCatalog]);

  // ---- Customer ----
  function lookupAccount() {
    const acct = normalizeAccount(account);
    if (!acct) return;
    const m = memberByAccount.get(acct);
    if (m) {
      setCustomer({ kind: "member", member: m });
      setNewName("");
      entryRef.current?.focus();
    } else {
      setCustomer({ kind: "new_member", accountNumber: acct, name: newName });
    }
  }

  const nameMatches = useMemo(() => {
    const q = nameSearch.trim().toLowerCase();
    if (q.length < 2) return [];
    return catalog.members.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 6);
  }, [nameSearch, catalog]);

  // ---- Cart ----
  function addItem(item: CatalogItem, qty: number) {
    if (item.priceCents === null) {
      setEntryError(`${item.code} ${item.name} has no price yet. Ask an admin to set it.`);
      return;
    }
    if (!item.active && !isAdmin) {
      setEntryError(`${item.code} ${item.name} is marked inactive. Ask an admin.`);
      return;
    }
    setEntryError(null);
    setCart((c) => {
      const i = c.findIndex((l) => l.itemId === item.id);
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, quantity: Math.min(999, l.quantity + qty) } : l));
      return [...c, { itemId: item.id, code: item.code, name: item.name, unitPriceCents: item.priceCents!, quantity: qty, warn: item.active ? undefined : "inactive" }];
    });
  }

  function onEntryEnter() {
    const raw = entry.trim();
    if (!raw) {
      // Empty Enter: done with items, go to payment.
      if (cart.length) document.getElementById("pay-cash")?.focus();
      return;
    }
    const p = parseEntry(raw);
    if (!p) return setEntryError(`"${raw}" isn't a code. Type something like A01, or A01 3 for three.`);
    const item = byCode.get(p.code);
    if (!item) {
      const prefix = p.code.replace(/\d+$/, "");
      const close = catalog.items.filter((i) => i.code.startsWith(prefix)).slice(0, 5);
      return setEntryError(`No item ${p.code}.${close.length ? ` ${prefix} items: ${close.map((c) => `${c.code} ${c.name}`).join(", ")}` : ""}`);
    }
    addItem(item, p.qty);
    setEntry("");
  }

  const setQty = (itemId: number, q: number) =>
    setCart((c) => (q <= 0 ? c.filter((l) => l.itemId !== itemId) : c.map((l) => (l.itemId === itemId ? { ...l, quantity: Math.min(999, q) } : l))));

  // ---- Payment ----
  const tendered = pays.map((p) => ({ method: p.method, amountCents: parseDollarsToCents(p.amount) ?? 0 }));
  const badAmount = pays.some((p) => p.amount.trim() !== "" && parseDollarsToCents(p.amount) === undefined);
  const totals = computeSale(cart, tendered, overpay);
  const remaining = Math.max(0, totals.totalCents - totals.tenderedCents);

  function addPay(method: PaymentMethod) {
    setPays((p) => [...p, { key: payKey.current++, method, amount: centsToInput(remaining || totals.totalCents), reference: "" }]);
    setTimeout(() => document.getElementById(`pay-amount-${payKey.current - 1}`)?.focus(), 0);
  }

  const isWalkUp = !customer || customer.kind === "walk_up";
  const needsMember = totals.balanceCents > 0 && isWalkUp;
  const newMemberMissingName = customer?.kind === "new_member" && !customer.name.trim();
  const checkMissingRef = pays.some((p) => p.method === "check" && !p.reference.trim());

  function clearSale() {
    setCustomer(null);
    setAccount("");
    setNewName("");
    setNameSearch("");
    setCart([]);
    setPays([]);
    setOverpay("change");
    setEntry("");
    setEntryError(null);
    setFormError(null);
    accountRef.current?.focus();
  }

  async function complete() {
    if (submitting.current) return; // a double click or double Enter can't submit twice
    setFormError(null);
    if (!cart.length) return setFormError("The cart is empty.");
    if (badAmount) return setFormError("One of the payment amounts isn't a number.");
    if (totals.problem) return setFormError(totals.problem);
    if (needsMember) return setFormError("There's money left to pay. Enter an account number to record it as an IOU, or add a payment.");
    if (newMemberMissingName) return setFormError("Enter the new member's name.");
    if (checkMissingRef) return setFormError("Enter the check number.");
    submitting.current = true;
    try {
      const cust =
        customer?.kind === "member"
          ? { kind: "member", memberId: customer.member.id }
          : customer?.kind === "new_member"
            ? { kind: "new_member", accountNumber: customer.accountNumber, name: customer.name }
            : { kind: "walk_up", name: customer?.kind === "walk_up" ? customer.name : undefined };
      const clientId = newId();
      const payload = {
        clientId,
        eventId,
        customer: cust,
        lines: cart.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitPriceCents: l.unitPriceCents })),
        payments: pays
          .map((p) => ({ method: p.method, amountCents: parseDollarsToCents(p.amount) ?? 0, reference: p.reference.trim() || null }))
          .filter((p) => p.amountCents > 0),
        overpay,
        soldAt: new Date().toISOString(),
        deviceId: deviceId(),
      };
      const customerLabel =
        customer?.kind === "member" ? customer.member.name : customer?.kind === "new_member" ? customer.name : customer?.name || "Walk-up";
      // Saved on the device before anything is sent.
      await outbox.put({
        clientId,
        eventId,
        payload,
        createdAt: new Date().toISOString(),
        status: "waiting",
        attempts: 0,
        summary: { customer: customerLabel, totalCents: totals.totalCents, itemCount: cart.reduce((s, l) => s + l.quantity, 0) },
      });
      clearSale();
      await reloadQueue();
      flush();
    } catch {
      setFormError("This device couldn't save the sale (storage is blocked). Write it on paper and enter it later.");
    } finally {
      submitting.current = false;
    }
  }

  // Ctrl/Cmd+Enter completes from anywhere; Escape clears an error.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        completeRef.current?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const waiting = queue.filter((q) => q.status !== "needs_attention");
  const attention = queue.filter((q) => q.status === "needs_attention");
  const stations = useMemo(() => {
    const g = new Map<string, CatalogItem[]>();
    for (const i of catalog.items.filter((i) => i.active && i.priceCents !== null)) {
      const k = i.station ? `${i.stationPrefix} · ${i.station}` : "No station";
      g.set(k, [...(g.get(k) ?? []), i]);
    }
    return [...g.entries()];
  }, [catalog]);

  return (
    <div className="space-y-4">
      {/* Connection and outbox status */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium", online ? "bg-green-50 text-green-800" : "bg-amber-100 text-amber-900")}>
          <span className={cx("h-2 w-2 rounded-full", online ? "bg-green-600" : "bg-amber-600")} />
          {online ? "Online" : "Offline: sales are saved on this device"}
        </span>
        {waiting.length > 0 && (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-900" role="status">
            {waiting.length} sale{waiting.length > 1 ? "s" : ""} waiting to send
          </span>
        )}
        {catalog.event.status !== "open" && <Badge tone="red">This event isn&apos;t open for sales yet. An admin opens it on the event page.</Badge>}
        <span className="ml-auto text-stone-500">Cashier: {userName}</span>
      </div>
      {signedOut && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          You&apos;ve been signed out, so sales can&apos;t be sent. They&apos;re safe on this device.{" "}
          <a href="/login" target="_blank" className="font-semibold underline">
            Sign in again in a new tab
          </a>
          , then come back here.
        </div>
      )}
      {attention.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-semibold">{attention.length} sale(s) on this device were refused by the server and need a look:</p>
          <ul className="mt-2 space-y-2">
            {attention.map((a) => (
              <li key={a.clientId} className="flex flex-wrap items-center gap-2">
                <span>
                  {a.summary.customer}, {formatCents(a.summary.totalCents)}: {a.lastError}
                </span>
                <button
                  className={buttonClass.small}
                  onClick={async () => {
                    await outbox.put({ ...a, status: "waiting" });
                    flush();
                  }}
                >
                  Try again
                </button>
                <button
                  className={buttonClass.small}
                  onClick={async () => {
                    if (!window.confirm("Remove this sale from the device? It has NOT been recorded. Re-ring it or write it down first.")) return;
                    await outbox.remove(a.clientId);
                    reloadQueue();
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr_22rem]">
        {/* 1. Customer */}
        <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">1. Customer</h2>
          <label className="block text-sm font-medium text-stone-700" htmlFor="acct">
            Account number
          </label>
          <input
            id="acct"
            ref={accountRef}
            autoFocus
            autoComplete="off"
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
              if (customer && customer.kind !== "walk_up") setCustomer(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (!account.trim()) entryRef.current?.focus();
                else lookupAccount();
              }
            }}
            onBlur={() => account.trim() && lookupAccount()}
            className={cx(inputClass, "mt-1 font-mono text-lg uppercase")}
            placeholder="Type and press Enter"
          />
          {customer?.kind === "member" && (
            <p className="mt-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
              <span className="font-semibold">{customer.member.name}</span>
              {customer.member.provisional && <span className="ml-1 text-xs">(new, unconfirmed)</span>}
            </p>
          )}
          {customer?.kind === "new_member" && (
            <div className="mt-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              <p>Account {customer.accountNumber} isn&apos;t on the list. Enter their name to add them; an admin will confirm it later.</p>
              <input
                autoFocus
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setCustomer({ kind: "new_member", accountNumber: customer.accountNumber, name: e.target.value });
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), entryRef.current?.focus())}
                className={cx(inputClass, "mt-2")}
                placeholder="Member's name"
                aria-label="New member name"
              />
            </div>
          )}

          <label className="mt-4 block text-sm font-medium text-stone-700" htmlFor="name-search">
            Or find by name
          </label>
          <input id="name-search" value={nameSearch} onChange={(e) => setNameSearch(e.target.value)} className={cx(inputClass, "mt-1")} placeholder="Part of a name" autoComplete="off" />
          {nameMatches.length > 0 && (
            <ul className="mt-1 divide-y divide-stone-100 rounded-md border border-stone-200">
              {nameMatches.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="flex w-full justify-between px-3 py-1.5 text-left text-sm hover:bg-amber-50"
                    onClick={() => {
                      setCustomer({ kind: "member", member: m });
                      setAccount(m.accountNumber);
                      setNameSearch("");
                      entryRef.current?.focus();
                    }}
                  >
                    <span>{m.name}</span>
                    <span className="font-mono text-stone-500">{m.accountNumber}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            className={cx(buttonClass.secondary, "mt-4 w-full", customer?.kind === "walk_up" && "border-amber-600 bg-amber-50")}
            onClick={() => {
              setCustomer({ kind: "walk_up", name: "" });
              setAccount("");
              entryRef.current?.focus();
            }}
          >
            Walk-up guest (pays in full)
          </button>
        </section>

        {/* 2. Items */}
        <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">2. Items from the slip</h2>
          <input
            ref={entryRef}
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                onEntryEnter();
              }
            }}
            className={cx(inputClass, "font-mono text-lg uppercase")}
            placeholder="Code, then Enter (A01, or A01 3 for three)"
            aria-label="Item code"
            autoComplete="off"
          />
          {entryError && (
            <p role="alert" className="mt-1 text-sm text-red-700">
              {entryError}
            </p>
          )}
          <p className="mt-1 text-xs text-stone-500">Press Enter on an empty box to go to payment.</p>

          {cart.length === 0 ? (
            <p className="py-8 text-center text-sm text-stone-400">No items yet</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <tbody className="divide-y divide-stone-100">
                {cart.map((l) => (
                  <tr key={l.itemId}>
                    <td className="py-2 pr-2 font-mono font-semibold">{l.code}</td>
                    <td className="py-2">
                      {l.name} {l.warn && <Badge tone="amber">{l.warn}</Badge>}
                      <div className="text-xs text-stone-500">{formatCents(l.unitPriceCents)} each</div>
                    </td>
                    <td className="py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" className={buttonClass.small} onClick={() => setQty(l.itemId, l.quantity - 1)} aria-label={`One less ${l.name}`}>
                          −
                        </button>
                        <input
                          value={l.quantity}
                          inputMode="numeric"
                          onChange={(e) => {
                            const n = Number(e.target.value.replace(/\D/g, ""));
                            setCart((c) => c.map((x) => (x.itemId === l.itemId ? { ...x, quantity: Math.min(999, Math.max(1, n || 1)) } : x)));
                          }}
                          className="w-12 rounded border border-stone-300 px-1 py-0.5 text-center tabular-nums"
                          aria-label={`Quantity of ${l.name}`}
                        />
                        <button type="button" className={buttonClass.small} onClick={() => setQty(l.itemId, l.quantity + 1)} aria-label={`One more ${l.name}`}>
                          +
                        </button>
                      </div>
                    </td>
                    <td className="w-20 py-2 text-right font-medium tabular-nums">{formatCents(l.unitPriceCents * l.quantity)}</td>
                    <td className="w-8 py-2 text-right">
                      <button type="button" className="text-stone-400 hover:text-red-700" onClick={() => setQty(l.itemId, 0)} aria-label={`Remove ${l.name}`}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <details className="mt-4 border-t border-stone-100 pt-3">
            <summary className="cursor-pointer text-sm font-medium text-stone-600">Tap items instead</summary>
            <div className="mt-3 space-y-3">
              {stations.map(([station, list]) => (
                <div key={station}>
                  <div className="mb-1 text-xs font-semibold uppercase text-stone-500">{station}</div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {list.map((i) => (
                      <button key={i.id} type="button" onClick={() => addItem(i, 1)} className="rounded-md border border-stone-200 px-2 py-2 text-left text-sm hover:border-amber-400 hover:bg-amber-50">
                        <span className="font-mono font-semibold">{i.code}</span> {i.name}
                        <div className="text-xs text-stone-500">{formatCents(i.priceCents)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </details>
        </section>

        {/* 3. Payment */}
        <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">3. Payment</h2>
          <div className="text-center">
            <div className="text-xs uppercase tracking-wide text-stone-500">Total</div>
            <div className="text-4xl font-bold tabular-nums" data-testid="cart-total">
              {formatCents(totals.totalCents)}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {(["cash", "venmo", "check"] as const).map((m) => (
              <button key={m} id={`pay-${m}`} type="button" onClick={() => addPay(m)} className={buttonClass.secondary} disabled={!cart.length}>
                {METHOD_LABEL[m]}
              </button>
            ))}
          </div>
          <div className="mt-3 space-y-2">
            {pays.map((p) => (
              <div key={p.key} className="rounded-md border border-stone-200 p-2">
                <div className="flex items-center gap-2">
                  <span className="w-14 text-sm font-medium">{METHOD_LABEL[p.method]}</span>
                  <span className="text-stone-400">$</span>
                  <input
                    id={`pay-amount-${p.key}`}
                    value={p.amount}
                    inputMode="decimal"
                    onChange={(e) => setPays((all) => all.map((x) => (x.key === p.key ? { ...x, amount: e.target.value } : x)))}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                        if (p.method !== "cash") document.getElementById(`pay-ref-${p.key}`)?.focus();
                        else completeRef.current?.focus();
                      }
                    }}
                    className="w-24 rounded border border-stone-300 px-2 py-1 text-right tabular-nums"
                    aria-label={`${METHOD_LABEL[p.method]} amount`}
                  />
                  <button type="button" className="ml-auto text-stone-400 hover:text-red-700" onClick={() => setPays((all) => all.filter((x) => x.key !== p.key))} aria-label="Remove payment">
                    ✕
                  </button>
                </div>
                {p.method !== "cash" && (
                  <input
                    id={`pay-ref-${p.key}`}
                    value={p.reference}
                    onChange={(e) => setPays((all) => all.map((x) => (x.key === p.key ? { ...x, reference: e.target.value } : x)))}
                    onKeyDown={(e) => e.key === "Enter" && !e.ctrlKey && (e.preventDefault(), completeRef.current?.focus())}
                    className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm"
                    placeholder={p.method === "check" ? "Check number (required)" : "Venmo name or note"}
                    aria-label={`${METHOD_LABEL[p.method]} reference`}
                  />
                )}
              </div>
            ))}
          </div>

          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-stone-600">Paid now</dt>
              <dd className="tabular-nums">{formatCents(totals.tenderedCents)}</dd>
            </div>
            {totals.tenderedCents > totals.totalCents && (
              <div className="rounded-md bg-sky-50 p-2">
                <div className="flex justify-between font-semibold text-sky-900">
                  <span>{overpay === "change" ? "Change to give" : "Donation"}</span>
                  <span className="tabular-nums">{formatCents(totals.tenderedCents - totals.totalCents)}</span>
                </div>
                <div className="mt-1 flex gap-3 text-xs">
                  <label className="flex items-center gap-1">
                    <input type="radio" checked={overpay === "change"} onChange={() => setOverpay("change")} /> Give change
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" checked={overpay === "donation"} onChange={() => setOverpay("donation")} /> Keep as donation
                  </label>
                </div>
              </div>
            )}
            {remaining > 0 && cart.length > 0 && (
              <div className={cx("flex justify-between font-semibold", isWalkUp ? "text-red-700" : "text-amber-800")}>
                <dt>{isWalkUp ? "Still to pay" : "IOU (owed later)"}</dt>
                <dd className="tabular-nums">{formatCents(remaining)}</dd>
              </div>
            )}
          </dl>

          {(formError || totals.problem) && (
            <p role="alert" className="mt-3 text-sm font-medium text-red-700">
              {formError ?? totals.problem}
            </p>
          )}
          <button ref={completeRef} type="button" onClick={complete} className={cx(buttonClass.primary, "mt-4 w-full py-3 text-base")} disabled={!cart.length}>
            {remaining > 0 && !isWalkUp && cart.length ? `Complete with ${formatCents(remaining)} IOU` : "Complete sale"}
          </button>
          <p className="mt-1 text-center text-xs text-stone-500">Ctrl+Enter completes from anywhere</p>
          <button type="button" onClick={clearSale} className="mt-2 w-full text-center text-xs text-stone-500 hover:text-stone-800">
            Clear and start over
          </button>
        </section>
      </div>

      {/* Recent and pending sales on this device */}
      <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">This device</h2>
        {queue.length === 0 && recent.length === 0 && <p className="text-sm text-stone-400">No sales yet.</p>}
        <ul className="divide-y divide-stone-100 text-sm">
          {queue.map((q) => (
            <li key={q.clientId} className="flex flex-wrap items-center gap-2 py-1.5">
              <Badge tone={q.status === "needs_attention" ? "red" : "amber"}>{q.status === "needs_attention" ? "Refused" : q.status === "sending" ? "Sending…" : "Waiting to send"}</Badge>
              <span>{q.summary.customer}</span>
              <span className="tabular-nums text-stone-600">{formatCents(q.summary.totalCents)}</span>
            </li>
          ))}
          {recent.map((r) => (
            <li key={r.clientId} className="flex flex-wrap items-center gap-2 py-1.5">
              <Badge tone="green">Saved</Badge>
              <Link href={`/events/${eventId}/transactions/${r.id}`} className="font-medium hover:underline">
                #{r.id} {r.customerName}
              </Link>
              <span className="tabular-nums text-stone-600">{formatCents(r.totalCents)}</span>
              {r.balanceCents > 0 && <Badge tone="amber">IOU {formatCents(r.balanceCents)}</Badge>}
              {r.flags.length > 0 && <Badge tone="blue">Flagged for review</Badge>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
