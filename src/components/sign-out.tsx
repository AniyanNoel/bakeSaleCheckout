"use client";

import { clearDeviceCache, outbox } from "@/lib/client/outbox";

/** Clears cached member names from the device on sign-out, and warns about unsent sales. */
export function SignOutButton({ action }: { action: () => Promise<void> }) {
  return (
    <form
      action={action}
      onSubmit={async (e) => {
        e.preventDefault();
        let unsent = 0;
        try {
          unsent = (await outbox.all()).length;
        } catch {
          // No outbox on this device.
        }
        if (unsent && !window.confirm(`${unsent} sale(s) on this device haven't reached the server yet. They stay on this device and send after the next sign-in. Sign out anyway?`)) return;
        await clearDeviceCache();
        await action();
      }}
    >
      <button className="text-stone-500 hover:text-stone-900">Sign out</button>
    </form>
  );
}
