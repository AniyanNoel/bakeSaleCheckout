import Link from "next/link";
import { getDb } from "@/db";
import { requirePermission } from "@/lib/auth";
import { listAudit } from "@/lib/services/audit-read";
import { buttonClass, PageHeader, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Audit log" };

const PAGE = 100;

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const actor = await requirePermission("viewAudit");
  const sp = await searchParams;
  const beforeId = Number(sp.before) || undefined;
  const eventId = Number(sp.event) || undefined;
  const rows = await listAudit(getDb(), actor, { beforeId, eventId, limit: PAGE });

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change, who made it and when. Entries can't be edited or deleted from the app." />
      <Table>
        <thead className="bg-stone-50">
          <tr>
            <Th>When</Th>
            <Th>Who</Th>
            <Th>What</Th>
            <Th>Record</Th>
            <Th>Details</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map(({ entry, userName }) => (
            <tr key={entry.id}>
              <Td className="whitespace-nowrap text-xs text-stone-500">{entry.at.toLocaleString("en-US")}</Td>
              <Td className="whitespace-nowrap">{userName ?? "—"}</Td>
              <Td className="whitespace-nowrap font-mono text-xs">{entry.action}</Td>
              <Td className="whitespace-nowrap text-xs text-stone-500">
                {entry.tableName}
                {entry.rowId && ` #${entry.rowId}`}
              </Td>
              <Td className="max-w-md">
                <Changes before={entry.before} after={entry.after} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {rows.length === PAGE && (
        <div className="mt-4">
          <Link href={`/audit?before=${rows[rows.length - 1].entry.id}${eventId ? `&event=${eventId}` : ""}`} className={buttonClass.secondary}>
            Older entries
          </Link>
        </div>
      )}
    </>
  );
}

const SKIP = new Set(["id", "createdAt", "updatedAt", "eventId"]);

/** Show only the fields that changed, or the new record when there is no "before". */
function Changes({ before, after }: { before: unknown; after: unknown }) {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !SKIP.has(k));
  const changed = before && after ? keys.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k])) : keys;
  if (!changed.length) return <span className="text-xs text-stone-400">no field changes</span>;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-stone-600">{changed.slice(0, 4).join(", ")}{changed.length > 4 ? "…" : ""}</summary>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {changed.map((k) => (
          <div key={k} className="contents">
            <dt className="font-medium text-stone-500">{k}</dt>
            <dd className="break-all font-mono">
              {before ? <span className="text-red-700 line-through">{show(b[k])}</span> : null} {after ? <span className="text-green-800">{show(a[k])}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function show(v: unknown): string {
  if (v === undefined) return "";
  const s = JSON.stringify(v);
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
}
