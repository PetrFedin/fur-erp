"use client";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { updateSupplyPlanEntry, removeSupplyPlanEntry } from "./actions";
import { STATUS_LABELS, type SupplyPlanStatusValue } from "./status";

export function EntryRowForm({
  entryId,
  status,
  quantity,
  eventDate,
  notes,
}: {
  entryId: string;
  status: SupplyPlanStatusValue;
  quantity: string;
  eventDate: string;
  notes: string;
}) {
  const bound = updateSupplyPlanEntry.bind(null, entryId);
  const boundRemove = removeSupplyPlanEntry.bind(null, entryId);

  return (
    <form action={bound} className="flex flex-wrap items-center gap-1 rounded border border-neutral-200 bg-neutral-50 p-1.5">
      <Select name="status" defaultValue={status} className="h-7 w-auto px-1.5 py-0 text-xs">
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <Input name="quantity" type="number" step="0.01" min="0" defaultValue={quantity} className="h-7 w-16 px-1.5 py-0 text-xs" />
      <Input name="eventDate" type="date" defaultValue={eventDate} className="h-7 w-32 px-1.5 py-0 text-xs" />
      <Input name="notes" defaultValue={notes} placeholder="заметка" className="h-7 w-24 px-1.5 py-0 text-xs" />
      <Button type="submit" variant="outline" size="sm" className="h-7 px-1.5 text-xs">
        OK
      </Button>
      <button
        type="submit"
        formAction={boundRemove}
        className="h-7 px-1.5 text-xs text-neutral-400 hover:text-red-600"
      >
        ×
      </button>
    </form>
  );
}
