"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { formatCents } from "@/lib/money";
import type { ImportPreview } from "@/lib/import/parse";
import { buttonClass, Card, Field, Notice, Select, Table, Td, Th } from "@/components/ui";
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
          Added <strong>{result.created.length}</strong> items.
          {result.skippedExisting.length > 0 && <> Skipped {result.skippedExisting.length} that were already in this event.</>}
        </p>
        {result.created.length > 0 && (
          <p className="mt-2 text-sm text-stone-600">{result.created.map((c) => `${c.code} ${c.name}`).join(" · ")}</p>
        )}
        <div className="mt-4 flex gap-2">
          <Link href={`/events/${eventId}/items`} className={buttonClass.primary}>
            Review items
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
  const quantity = "none"; // quantities aren't used for checkout
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
          {data.items.length} items. {flagged > 0 && <>{flagged} items have something to check.</>} Untick
          any you don&apos;t want.
        </p>
        <Table>
          <thead className="bg-stone-50">
            <tr>
              <Th>Import</Th>
              <Th>Item</Th>
              <Th className="text-right">Price</Th>
              <Th>To check</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {data.items.map((it) => {
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
                  <Td className="max-w-xs text-xs text-amber-800">{it.warnings.join(" ")}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Card title="3. Choose how to save it">
        <div className="max-w-md">
          <input type="hidden" name="quantity" value={quantity} />
          <div className="space-y-4">
            <Field label="Put the items at" hint="Codes come from the table letter. You can move items and renumber later.">
              <Select name="stationId" defaultValue="">
                <option value="">No table yet (codes U01, U02…)</option>
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
        {error && (
          <div className="mt-4">
            <Notice tone="red">{error}</Notice>
          </div>
        )}
        <button type="submit" disabled={applying || count === 0} className={`${buttonClass.primary} mt-5`}>
          {applying ? "Importing…" : `Import ${count} items`}
        </button>
      </Card>
    </form>
  );
}

