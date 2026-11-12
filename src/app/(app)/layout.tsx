import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { SignOutButton } from "@/components/sign-out";
import { logoutAction } from "../(public)/actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const actor = await requireUser();
  const links = [
    { href: "/events", label: "Events", show: true },
    { href: "/people", label: "People", show: can(actor.role, "manageMembers") },
  ].filter((l) => l.show);
  return (
    <>
      <header className="border-b border-stone-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/events" className="font-bold text-amber-800">
            Checkout
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
              {actor.name}
            </Link>
            <SignOutButton action={logoutAction} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 print:max-w-none print:p-0">{children}</main>
    </>
  );
}
