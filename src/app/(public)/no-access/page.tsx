import { TextLink } from "@/components/ui";

export const metadata = { title: "No access" };

export default function NoAccessPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-xl font-bold">Your account can&apos;t open that page</h1>
      <p className="mt-2 text-sm text-stone-600">If you think it should, ask an admin to change your role.</p>
      <p className="mt-6">
        <TextLink href="/events">Back to events</TextLink>
      </p>
    </main>
  );
}
