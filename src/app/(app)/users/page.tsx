import { getDb } from "@/db";
import { requirePermission } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/permissions";
import { listUsers, MIN_PASSWORD_LENGTH } from "@/lib/services/users";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { createUserAction, resetPasswordAction, updateUserAction } from "./actions";

export const metadata = { title: "Users" };

const ROLE_HELP = {
  admin: "Everything: events, items, prices, signups, users, audit log.",
  cashier: "Checkout and payments (coming in the next phase). Can view items.",
  volunteer: "Can view items and the price sheet.",
};

export default async function UsersPage() {
  const actor = await requirePermission("manageUsers");
  const users = await listUsers(getDb(), actor);

  return (
    <>
      <PageHeader title="Users" subtitle="Everyone signs in with their own account so the audit log shows who did what." />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-3">
          {users.map((u) => (
            <Card key={u.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">
                    {u.name} {u.id === actor.id && <span className="text-sm font-normal text-stone-500">(you)</span>}
                  </div>
                  <div className="text-sm text-stone-500">{u.email}</div>
                </div>
                <div className="flex gap-1">
                  <Badge tone={u.role === "admin" ? "amber" : "gray"}>{ROLE_LABELS[u.role]}</Badge>
                  {!u.active && <Badge tone="red">Deactivated</Badge>}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-4 border-t border-stone-100 pt-4">
                <ActionForm action={updateUserAction.bind(null, u.id)} className="flex flex-wrap items-start gap-2">
                  <Select name="role" defaultValue={u.role} className="w-32" aria-label="Role">
                    {(["admin", "cashier", "volunteer"] as const).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                  <Select name="active" defaultValue={u.active ? "yes" : "no"} className="w-36" aria-label="Access">
                    <option value="yes">Can sign in</option>
                    <option value="no">Deactivated</option>
                  </Select>
                  <SubmitButton variant="secondary">Update</SubmitButton>
                </ActionForm>
                <ActionForm action={resetPasswordAction.bind(null, u.id)} resetOnSuccess className="flex flex-wrap items-start gap-2">
                  <Input name="password" type="text" placeholder="New temporary password" minLength={MIN_PASSWORD_LENGTH} required className="w-56" autoComplete="off" aria-label="New password" />
                  <SubmitButton variant="secondary" pendingText="Resetting…">
                    Reset password
                  </SubmitButton>
                </ActionForm>
              </div>
            </Card>
          ))}
        </div>

        <Card title="Add a person">
          <ActionForm action={createUserAction} resetOnSuccess className="space-y-4">
            <Field label="Name">
              <Input name="name" required />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" required autoComplete="off" />
            </Field>
            <Field label="Role">
              <Select name="role" defaultValue="cashier">
                {(["cashier", "volunteer", "admin"] as const).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}: {ROLE_HELP[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Temporary password" hint={`At least ${MIN_PASSWORD_LENGTH} characters. They can change it under their name at the top.`}>
              <Input name="password" type="text" minLength={MIN_PASSWORD_LENGTH} required autoComplete="off" />
            </Field>
            <SubmitButton pendingText="Creating…">Create account</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
