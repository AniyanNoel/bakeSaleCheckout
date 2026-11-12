import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/db";
import { countUsers, MIN_PASSWORD_LENGTH } from "@/lib/services/users";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { setupAction } from "../actions";
import { AuthShell } from "@/components/auth-shell";

export const metadata = { title: "First-time setup" };

/** Only reachable while there are no accounts at all. */
export default async function SetupPage() {
  await connection(); // always check the database at request time, never at build time
  if ((await countUsers(getDb())) > 0) redirect("/login");
  return (
    <AuthShell title="First-time setup" subtitle="Create the first admin account. You can add cashiers and other admins after.">
      <ActionForm action={setupAction} className="space-y-4">
        <Field label="Your name">
          <Input name="name" required autoFocus />
        </Field>
        <Field label="Email">
          <Input name="email" type="email" autoComplete="username" required />
        </Field>
        <Field label="Password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
          <Input name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
        </Field>
        <Field label="Password again">
          <Input name="password2" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
        </Field>
        <SubmitButton className="w-full" pendingText="Creating…">
          Create admin account
        </SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
