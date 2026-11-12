"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { formatCents } from "@/lib/money";
import type { ImportPreview } from "@/lib/import/parse";
import { Badge, buttonClass, Card, Field, Notice, Select, Table, Td, Th } from "@/components/ui";
import { applyImportAction, previewImportAction, type PreviewState } from "../../actions";

export function ImportWizard({ eventId, stations }: { eventId: number; stations: { id: number; label: string }[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [previewState, preview, previewing] = useActionState(previewImportAction, null);
  const [applyState, apply, applying] = useActionState(applyImportAction.bind(null, eventId), null as PreviewState);

  // The File object is kept in state (not in a form field) so it survives React's
  // automatic form reset and can be sent again for the real import.
  function readFile() {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    startTransition(() => preview(fd));
  }

  const result = applyState?.result;
  if (result) {
    return (
      <Card title="Import finished">
        <p className="text-sm">
          Added <strong>{result.created.length}</strong> items and <strong>{result.signupsCreated}</strong> volunteer signups.
          {result.skippedExisting.length > 0 && <> Skipped {result.skippedExisting.length} that were already in this event.</>}
        </p>
        {result.created.length > 0 && (
          <p className="mt-2 text-sm text-stone-600">{result.created.map((c) => `${c.code} ${c.name}`).join(" · ")}</p>
        )}
        <div className="mt-4 flex gap-2">
          <Link href={`/events/${eventId}/items`} className={buttonClass.primary}>
            Review items
          </Link>
          <Link href={`/events/${eventId}/signups`} className={buttonClass.secondary}>
            Review signups
          </Link>
        </div>
      </Card>
    );
  }

  const data = previewState?.preview;
  return (
    <div className="space-y-6">
      <Card title="1. Choose the file">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-stone-200"
          />
          <button type="button" onClick={readFile} disabled={!file || previewing} className={buttonClass.secondary}>
            {previewing ? "Reading…" : "Read file"}
          </button>
        </div>
        {previewState?.error && <p className="mt-3 text-sm font-medium text-red-700">{previewState.error}</p>}
      </Card>

      {data && file && (
        <PreviewForm
          key={previewState?.fileName}
          data={data}
          stations={stations}
          applying={applying}
          error={applyState?.error}
          onSubmit={(fd) => {
            fd.set("file", file);
            startTransition(() => apply(fd));
          }}
        />
      )}
    </div>
  );
}

function PreviewForm({
  data,
  stations,
  applying,
  error,
  onSubmit,
}: {
  data: ImportPreview;
  stations: { id: number; label: string }[];
  applying: boolean;
  error?: string;
  onSubmit: (fd: FormData) => void;
}) {
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [quantity, setQuantity] = useState(
    data.hasQuantityConflicts ? "" : data.quantitySources[0] ? `source:${data.quantitySources[0]}` : "none",
  );
  const withVolunteers = data.items.reduce((n, i) => n + i.volunteers.length, 0);
  const flagged = data.items.filter((i) => i.warnings.length).length;
  const count = data.items.length - skip.size;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        skip.forEach((k) => fd.append("skip", k));
        onSubmit(fd);
      }}
      className="space-y-6"
    >
      <Card title="2. Check what was found">
        <p className="mb-3 text-sm text-stone-600">
          Read {data.sheetsRead.join(" and ")}
          {data.sheetsIgnored.length > 0 && <> (ignored {data.sheetsIgnored.join(", ")}, no Item column)</>}. Found{" "}
          {data.items.length} items and {withVolunteers} volunteer entries. {flagged > 0 && <>{flagged} items have something to check.</>} Untick
          any you don&apos;t want.
        </p>
        <Table>
          <thead className="bg-stone-50">
            <tr>
              <Th>Import</Th>
              <Th>Item</Th>
              <Th className="text-right">Price</Th>
              {data.quantitySources.map((s) => (
                <Th key={s} className="text-right">
                  {s}
                </Th>
              ))}
              <Th>Volunteers</Th>
              <Th>To check</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {data.items.map((it) => {
              const values = Object.values(it.quantities).filter((q) => q !== null);
              const conflict = new Set(values).size > 1;
              return (
                <tr key={it.key} className={skip.has(it.key) ? "text-stone-400" : ""}>
                  <Td>
                    <input
                      type="checkbox"
                      aria-label={`Import ${it.name}`}
                      checked={!skip.has(it.key)}
                      onChange={(e) => {
                        const next = new Set(skip);
                        if (e.target.checked) next.delete(it.key);
                        else next.add(it.key);
                        setSkip(next);
                      }}
                      className="h-4 w-4"
                    />
                  </Td>
                  <Td className="font-medium">{it.name}</Td>
                  <Td className="text-right tabular-nums">{formatCents(it.priceCents)}</Td>
                  {data.quantitySources.map((s) => (
                    <Td key={s} className={`text-right tabular-nums ${conflict ? "font-semibold text-amber-800" : ""}`}>
                      {s in it.quantities ? (it.quantities[s] ?? "—") : <span className="text-stone-300">not listed</span>}
                    </Td>
                  ))}
                  <Td className="text-xs">
                    {it.volunteers.map((v) => (
                      <div key={v.raw}>
                        {v.name} {v.qty !== null ? `(${v.qty})` : <Badge tone="amber">no qty</Badge>}
                      </div>
                    ))}
                  </Td>
                  <Td className="max-w-xs text-xs text-amber-800">{it.warnings.join(" ")}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Card title="3. Choose how to save it">
        <div className="grid gap-5 md:grid-cols-2">
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-stone-700">Expected quantity (the budget number)</legend>
            {data.hasQuantityConflicts && (
              <p className="mb-2 text-xs text-amber-800">The tabs disagree for some items (highlighted above), so please pick one. You can edit any item later.</p>
            )}
            <div className="space-y-1 text-sm">
              {data.quantitySources.map((s) => (
                <Radio key={s} value={`source:${s}`} current={quantity} onChange={setQuantity}>
                  Use {s}
                </Radio>
              ))}
              {data.quantitySources.length > 1 && (
                <>
                  <Radio value="larger" current={quantity} onChange={setQuantity}>
                    Use whichever is larger
                  </Radio>
                  <Radio value="smaller" current={quantity} onChange={setQuantity}>
                    Use whichever is smaller
                  </Radio>
                </>
              )}
              <Radio value="none" current={quantity} onChange={setQuantity}>
                Leave blank and fill in later
              </Radio>
            </div>
            <input type="hidden" name="quantity" value={quantity} />
          </fieldset>
          <div className="space-y-4">
            <Field label="Put the items at" hint="Codes come from the station letter. You can move items and renumber later.">
              <Select name="stationId" defaultValue="">
                <option value="">No station yet (codes U01, U02…)</option>
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="importVolunteers" defaultChecked={withVolunteers > 0} disabled={withVolunteers === 0} className="h-4 w-4" />
              Also import the {withVolunteers} volunteer signups
            </label>
          </div>
        </div>
        {error && (
          <div className="mt-4">
            <Notice tone="red">{error}</Notice>
          </div>
        )}
        <button type="submit" disabled={applying || !quantity || count === 0} className={`${buttonClass.primary} mt-5`}>
          {applying ? "Importing…" : `Import ${count} items`}
        </button>
        {!quantity && <span className="ml-3 text-sm text-stone-500">Pick an expected quantity option first.</span>}
      </Card>
    </form>
  );
}

function Radio({ value, current, onChange, children }: { value: string; current: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2">
      <input type="radio" checked={current === value} onChange={() => onChange(value)} className="h-4 w-4" />
      {children}
    </label>
  );
}
