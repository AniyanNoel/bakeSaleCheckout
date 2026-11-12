import type { Item, Station } from "@/db/schema";
import { CATEGORY_SUGGESTIONS, UNIT_SUGGESTIONS } from "@/lib/constants";
import { centsToInput } from "@/lib/money";
import { Field, Input, Select } from "./ui";

/** The inputs shared by the add-item and edit-item forms. */
export function ItemFields({
  item,
  stations,
  codeLocked,
  disabled,
}: {
  item?: Item;
  stations: Station[];
  codeLocked: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-6">
      <Field label="Code" className="sm:col-span-1" hint={codeLocked ? "Locked" : item ? undefined : "Blank = next free"}>
        <Input name="code" defaultValue={item?.code ?? ""} placeholder="Auto" className="font-mono uppercase" maxLength={5} disabled={disabled || codeLocked} />
      </Field>
      <Field label="Name" className="sm:col-span-3">
        <Input name="name" defaultValue={item?.name ?? ""} required disabled={disabled} />
      </Field>
      <Field label="Station" className="sm:col-span-2">
        <Select name="stationId" defaultValue={item?.stationId ?? ""} disabled={disabled}>
          <option value="">No station yet</option>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.codePrefix} · {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Price ($)" className="sm:col-span-1" hint="Blank = not set">
        <Input name="price" inputMode="decimal" defaultValue={centsToInput(item?.unitPriceCents)} placeholder="0.00" disabled={disabled} />
      </Field>
      <Field label="Unit of sale" className="sm:col-span-1">
        <Input name="unit" list="unit-suggestions" defaultValue={item?.unit ?? "each"} disabled={disabled} />
      </Field>
      <Field label="Category" className="sm:col-span-2">
        <Input name="category" list="category-suggestions" defaultValue={item?.category ?? ""} disabled={disabled} />
      </Field>
      <Field label="Expected qty" className="sm:col-span-1" hint="For the budget">
        <Input name="expectedQty" inputMode="numeric" defaultValue={item?.expectedQty ?? ""} disabled={disabled} />
      </Field>
      <Field label="Available qty" className="sm:col-span-1" hint="On hand to sell">
        <Input name="availableQty" inputMode="numeric" defaultValue={item?.availableQty ?? ""} disabled={disabled} />
      </Field>
      <input type="hidden" name="activePresent" value="1" />
      <label className="flex items-center gap-2 text-sm sm:col-span-6">
        <input type="checkbox" name="active" defaultChecked={item?.active ?? true} disabled={disabled} className="h-4 w-4 rounded border-stone-300" />
        Active (offered at checkout)
      </label>
      <datalist id="unit-suggestions">
        {UNIT_SUGGESTIONS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <datalist id="category-suggestions">
        {CATEGORY_SUGGESTIONS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}
