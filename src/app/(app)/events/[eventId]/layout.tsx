import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { loadEvent } from "@/lib/load";
import { can } from "@/lib/permissions";
import { SubNav } from "@/components/sub-nav";
import { StatusBadge } from "@/components/ui";

export default async function EventLayout({ children, params }: LayoutProps<"/events/[eventId]">) {
  const { eventId } = await params;
  const actor = await requireUser();
  const ev = await loadEvent(eventId);
  const base = `/events/${ev.id}`;
  const admin = can(actor.role, "manageItems");
  const links = [
    { href: base, label: "Overview", exact: true },
    { href: `${base}/items`, label: "Items" },
    ...(admin
      ? [
          { href: `${base}/import`, label: "Import" },
          { href: `${base}/signups`, label: "Signups" },
          { href: `${base}/bring-list`, label: "Bring list" },
        ]
      : []),
    { href: `${base}/price-sheet`, label: "Price sheet" },
  ];
  return (
    <>
      <div className="mb-4 print:hidden">
        <Link href="/events" className="text-sm text-stone-500 hover:text-stone-800">
          ← All events
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{ev.name}</h1>
          <StatusBadge status={ev.status} />
          <span className="text-sm text-stone-500">{ev.saleDate ? formatDate(ev.saleDate) : "Date not set"}</span>
        </div>
      </div>
      <SubNav links={links} />
      {children}
    </>
  );
}
