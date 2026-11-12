import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { countUsers } from "@/lib/services/users";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { AuthShell } from "@/components/auth-shell";
import { loginAction } from "../actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/events");
  if ((await countUsers(getDb())) === 0) redirect("/setup");
  return (
    <AuthShell title="Sign in" subtitle="Use the account an admin set up for you.">
      <ActionForm action={loginAction} className="space-y-4">
        <Field label="Email">
          <Input name="email" type="email" autoComplete="username" required autoFocus />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <SubmitButton className="w-full" pendingText="Signing in…">
          Sign in
        </SubmitButton>
      </ActionForm>
      <p className="mt-6 text-xs text-stone-500">Forgot your password? Ask an admin to reset it.</p>
    </AuthShell>
  );
}
