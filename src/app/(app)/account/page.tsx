import { requireUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/permissions";
import { MIN_PASSWORD_LENGTH } from "@/lib/services/users";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Field, Input, PageHeader } from "@/components/ui";
import { changePasswordAction } from "./actions";

export const metadata = { title: "Your account" };

export default async function AccountPage() {
  const actor = await requireUser();
  return (
    <>
      <PageHeader title="Your account" subtitle={`${actor.name} · ${ROLE_LABELS[actor.role]}`} />
      <Card title="Change password" className="max-w-md">
        <ActionForm action={changePasswordAction} className="space-y-4">
          <Field label="Current password">
            <Input name="current" type="password" autoComplete="current-password" required />
          </Field>
          <Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters. You'll sign in again after.`}>
            <Input name="next" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
          </Field>
          <Field label="New password again">
            <Input name="next2" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
          </Field>
          <SubmitButton>Change password</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
