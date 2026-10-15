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
    <details className="text-xs">
      <summary className="flex min-h-11 min-w-11 cursor-pointer list-none items-center gap-1 text-neutral-600 hover:text-neutral-900" title={notes ? `${notes} — изменить` : "Изменить"} aria-label="Изменить запись">
        {notes ? <span className="max-w-[9rem] truncate">{notes}</span> : null}
        <span aria-hidden>✎</span>
      </summary>
    <form
      action={async (formData) => {
        const res = await bound(formData);
        if (res?.error) window.alert(res.error);
      }}
      className="flex flex-wrap items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1.5">
      <Select name="status" defaultValue={status} className="ui-field h-11 sm:h-7 w-auto px-1.5 py-0 text-xs">
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <Input name="quantity" type="number" step="1" min="1" max="1000000" defaultValue={quantity} className="ui-field h-11 sm:h-7 w-16 px-1.5 py-0 text-xs" />
      <Input name="eventDate" type="date" defaultValue={eventDate} className="ui-field h-11 sm:h-7 w-32 px-1.5 py-0 text-xs" />
      <Input name="notes" defaultValue={notes} placeholder="заметка" className="ui-field h-11 sm:h-7 w-24 px-1.5 py-0 text-xs" />
      <Button type="submit" variant="outline" size="sm" className="btn-accent h-11 sm:h-7 px-1.5 text-xs">
        OK
      </Button>
      <button
        type="submit"
        formAction={boundRemove}
        onClick={(e) => {
          if (!window.confirm("Убрать эту плановую поставку из плана? Количество и заметка будут удалены.")) e.preventDefault();
        }}
        aria-label="Убрать запись из плана"
        className="h-11 sm:h-7 px-1.5 text-xs text-neutral-500 hover:text-red-600"
      >
        ×
      </button>
    </form>
    </details>
  );
}
