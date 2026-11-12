import { getDb } from "@/db";
import { requirePermission } from "@/lib/auth";
import { listPeople } from "@/lib/services/members";
import { ActionForm, SubmitButton } from "@/components/forms";
import {
  buttonClass,
  Card,
  Field,
  Input,
  PageHeader,
  Table,
  Td,
  Th,
} from "@/components/ui";
import {
  createPersonAction,
  deletePersonAction,
  importDirectoryAction,
  updatePersonAction,
} from "./actions";

export const metadata = { title: "People" };

export default async function PeoplePage({
  searchParams,
}: PageProps<"/people">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const actor = await requirePermission("manageMembers");
  const people = await listPeople(getDb(), actor, q);

  return (
    <>
      <PageHeader
        title="People"
        subtitle="Church account numbers and names. At checkout, typing an account number fills in the name. New numbers typed at checkout are added here automatically."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-3">
          <form className="flex gap-2" action="">
            <div className="w-64">
              <Input
                name="q"
                defaultValue={q}
                placeholder="Search name or account #"
                aria-label="Search"
              />
            </div>
            <button className={buttonClass.secondary}>Search</button>
          </form>
          {people.length === 0 ? (
            <Card>
              <p className="text-sm text-stone-600">
                {q
                  ? "Nobody matches."
                  : "Nobody yet. Load the church directory, add people here, or just start checking out."}
              </p>
            </Card>
          ) : (
            <Table>
              <thead className="bg-stone-50">
                <tr>
                  <Th>Account</Th>
                  <Th>Name</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {people.map((p) => (
                  <tr key={p.id}>
                    <Td className="font-mono">{p.accountNumber}</Td>
                    <Td>{p.name}</Td>
                    <Td>
                      <details>
                        <summary className="cursor-pointer text-sm text-amber-800">
                          Edit
                        </summary>
                        <ActionForm
                          action={updatePersonAction.bind(null, p.id)}
                          className="mt-2 flex flex-wrap gap-2"
                          showSuccess={false}
                        >
                          <Input
                            name="accountNumber"
                            defaultValue={p.accountNumber}
                            aria-label="Account number"
                            className="font-mono"
                            required
                          />
                          <Input
                            name="name"
                            defaultValue={p.name}
                            aria-label="Name"
                            required
                          />
                          <SubmitButton variant="secondary">Save</SubmitButton>
                        </ActionForm>
                        <ActionForm
                          action={deletePersonAction.bind(null, p.id)}
                          confirm={`Remove ${p.name} (#${p.accountNumber}) from the list? Their past checkouts stay.`}
                          className="mt-2"
                          showSuccess={false}
                        >
                          <SubmitButton variant="small">Remove</SubmitButton>
                        </ActionForm>
                      </details>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <p className="text-xs text-stone-500">{people.length} people</p>
        </div>

        <div className="space-y-6">
          <Card title="Add a person">
            <ActionForm
              action={createPersonAction}
              resetOnSuccess
              className="space-y-3"
            >
              <Field label="Account #">
                <Input name="accountNumber" className="font-mono" required />
              </Field>
              <Field label="Name">
                <Input name="name" required />
              </Field>
              <SubmitButton>Add</SubmitButton>
            </ActionForm>
          </Card>
          <Card title="Load the church directory">
            <ActionForm
              action={importDirectoryAction}
              resetOnSuccess
              className="space-y-3"
            >
              <p className="text-sm text-stone-600">
                An Excel (.xlsx) or .csv file with a header row that has{" "}
                <strong>Account</strong> and <strong>Name</strong> columns (or
                First name and Last name). Safe to load again: existing numbers
                just get their name updated.
              </p>
              <input
                type="file"
                name="file"
                accept=".xlsx,.csv"
                required
                className="block w-full text-sm"
              />
              <SubmitButton pendingText="Loading…">Load file</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
