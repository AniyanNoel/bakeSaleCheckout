import type { Item, Station } from "@/db/schema";
import { centsToInput } from "@/lib/money";
import { Field, Input, Select } from "./ui";

/** The inputs shared by the add-item and edit-item forms. */
export function ItemFields({
  item,
  stations,
  defaultStationId,
}: {
  item?: Item;
  stations: Station[];
  defaultStationId?: number;
  /** Kept for older callers; codes are never locked now. */
  codeLocked?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Table" className="sm:col-span-2">
        <Select name="stationId" defaultValue={item?.stationId ?? defaultStationId ?? ""}>
          <option value="">No table yet</option>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.codePrefix} · {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Item name" className="sm:col-span-2">
        <Input name="name" defaultValue={item?.name ?? ""} placeholder="e.g. Kappa and fish" required />
      </Field>
      <Field label="Price ($)" hint="Blank = not set yet">
        <Input name="price" inputMode="decimal" defaultValue={centsToInput(item?.unitPriceCents)} placeholder="0.00" />
      </Field>
      <Field label="Code" hint={item ? undefined : "Blank = next free, like A03"}>
        <Input name="code" defaultValue={item?.code ?? ""} placeholder="Auto" className="font-mono uppercase" maxLength={5} />
      </Field>
      {/* Not shown any more, but kept so editing an imported item doesn't wipe them. */}
      <input type="hidden" name="unit" value={item?.unit ?? "each"} />
      <input type="hidden" name="category" value={item?.category ?? ""} />
      <input type="hidden" name="expectedQty" value={item?.expectedQty ?? ""} />
      <input type="hidden" name="availableQty" value={item?.availableQty ?? ""} />
      <input type="hidden" name="activePresent" value="1" />
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="active" defaultChecked={item?.active ?? true} className="h-4 w-4 rounded border-stone-300" />
        For sale (uncheck to hide it at checkout)
      </label>
    </div>
  );
}
