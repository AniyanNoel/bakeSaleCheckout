import type { Member } from "@/db/schema";
import { Field, Input } from "./ui";

export function MemberFields({ member }: { member?: Member }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[8rem_1fr] gap-3">
        <Field label="Account #">
          <Input name="accountNumber" defaultValue={member?.accountNumber ?? ""} className="font-mono uppercase" required />
        </Field>
        <Field label="Name">
          <Input name="name" defaultValue={member?.name ?? ""} required />
        </Field>
      </div>
      <fieldset className="rounded-md border border-stone-200 p-3">
        <legend className="px-1 text-sm font-medium text-stone-700">Contact for payment reminders (optional)</legend>
        <p className="mb-3 text-xs text-stone-500">Only admins can see these. Save them only when the member (or a parent, for a minor) has agreed.</p>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" name="contactConsent" defaultChecked={member?.contactConsent ?? false} className="h-4 w-4" />
          They agreed to be contacted about payments
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone">
            <Input name="phone" defaultValue={member?.phone ?? ""} autoComplete="off" />
          </Field>
          <Field label="Email">
            <Input name="email" type="email" defaultValue={member?.email ?? ""} autoComplete="off" />
          </Field>
        </div>
        <Field label="How they agreed" className="mt-3">
          <Input name="contactConsentNote" defaultValue={member?.contactConsentNote ?? ""} placeholder="e.g. in person at checkout, Mar 14" />
        </Field>
      </fieldset>
      {member && (
        <>
          <input type="hidden" name="activePresent" value="1" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={member.active} className="h-4 w-4" />
            Active (shows in checkout lookup)
          </label>
        </>
      )}
    </div>
  );
}
