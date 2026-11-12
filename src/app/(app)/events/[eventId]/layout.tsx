import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { loadEvent } from "@/lib/load";
import { SubNav } from "@/components/sub-nav";

export default async function EventLayout({ children, params }: LayoutProps<"/events/[eventId]">) {
  const { eventId } = await params;
  await requireUser();
  const ev = await loadEvent(eventId);
  const base = `/events/${ev.id}`;
  const links = [
    { href: `${base}/checkout`, label: "Checkout" },
    { href: `${base}/records`, label: "Records" },
    { href: `${base}/items`, label: "Items" },
    { href: `${base}/price-sheet`, label: "Code sheet" },
    { href: `${base}/import`, label: "Import items" },
    { href: base, label: "Settings", exact: true },
  ];
  return (
    <>
      <div className="mb-4 print:hidden">
        <Link href="/events" className="text-sm text-stone-500 hover:text-stone-800">
          ← All events
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{ev.name}</h1>
          <span className="text-sm text-stone-500">{ev.saleDate ? formatDate(ev.saleDate) : "Date not set"}</span>
        </div>
      </div>
      <SubNav links={links} />
      {children}
    </>
  );
}
