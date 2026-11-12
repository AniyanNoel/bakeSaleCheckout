import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-xl font-bold">That page doesn&apos;t exist</h1>
      <p className="mt-6">
        <Link href="/events" className="font-medium text-amber-800 hover:underline">
          Back to events
        </Link>
      </p>
    </main>
  );
}
