import Link from "next/link";
import { getDb } from "@/db";
import { requirePermission } from "@/lib/auth";
import { listMembers } from "@/lib/services/members";
import { ActionForm, SubmitButton } from "@/components/forms";
import { MemberFields } from "@/components/member-fields";
import { Badge, Card, PageHeader, Table, Td, Th } from "@/components/ui";
import { createMemberAction } from "../money-actions";

export const metadata = { title: "Members" };

export default async function MembersPage() {
  const actor = await requirePermission("manageMembers");
  const members = await listMembers(getDb(), actor);
  const provisional = members.filter((m) => m.provisional).length;

  return (
    <>
      <PageHeader
        title="Church members"
        subtitle={provisional ? `${provisional} added at checkout and waiting for you to confirm.` : "Account numbers and names used at checkout."}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        {members.length === 0 ? (
          <Card>
            <p className="text-sm text-stone-600">No members yet. Add them here, or cashiers can add them at checkout.</p>
          </Card>
        ) : (
          <Table>
            <thead className="bg-stone-50">
              <tr>
                <Th>Account</Th>
                <Th>Name</Th>
                <Th>Contact</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {members.map((m) => (
                <tr key={m.id}>
                  <Td className="font-mono">{m.accountNumber}</Td>
                  <Td>
                    <Link href={`/members/${m.id}`} className="font-medium text-amber-800 hover:underline">
                      {m.name}
                    </Link>
                  </Td>
                  <Td className="text-xs">{m.contactConsent ? [m.phone, m.email].filter(Boolean).join(", ") || "Consent, no details" : "—"}</Td>
                  <Td>
                    <div className="flex gap-1">
                      {m.provisional && <Badge tone="amber">Confirm</Badge>}
                      {!m.active && <Badge>Inactive</Badge>}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Card title="Add a member">
          <ActionForm action={createMemberAction} resetOnSuccess className="space-y-4">
            <MemberFields />
            <SubmitButton>Add member</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
