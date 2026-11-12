import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { logoutAction } from "../(public)/actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const actor = await requireUser();
  const links = [
    { href: "/events", label: "Events", show: true },
    { href: "/users", label: "Users", show: can(actor.role, "manageUsers") },
    { href: "/audit", label: "Audit log", show: can(actor.role, "viewAudit") },
  ].filter((l) => l.show);
  return (
    <>
      <header className="border-b border-stone-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/events" className="font-bold text-amber-800">
            Youth Bake Sale
          </Link>
          <nav className="flex gap-4 text-sm">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="text-stone-700 hover:text-stone-950">
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <Link href="/account" className="text-stone-700 hover:text-stone-950">
              {actor.name} <span className="text-stone-400">· {ROLE_LABELS[actor.role]}</span>
            </Link>
            <form action={logoutAction}>
              <button className="text-stone-500 hover:text-stone-900">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 print:max-w-none print:p-0">{children}</main>
    </>
  );
}
