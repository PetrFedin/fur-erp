"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { FITTING_STATUS, FITTING_STATUS_KEYS } from "@/lib/fittings";
import type { FittingFormState } from "../actions";

export function EditFittingForm({
  action,
  defaults,
}: {
  action: (prev: FittingFormState, fd: FormData) => Promise<FittingFormState>;
  defaults: { date: string; size: string; status: string; comment: string };
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (prev: FittingFormState, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.ok) setOpen(false);
    return r;
  }, {} as FittingFormState);

  if (!open) {
    return (
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          Изменить
        </Button>
      </div>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-3 border-t border-neutral-200 pt-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="e-date">Дата</Label>
          <Input id="e-date" name="date" type="date" defaultValue={defaults.date} required />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="e-size">Размер</Label>
          <Input id="e-size" name="size" defaultValue={defaults.size} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="e-status">Итог</Label>
          <Select id="e-status" name="status" defaultValue={defaults.status}>
            {FITTING_STATUS_KEYS.map((k) => (
              <option key={k} value={k}>
                {FITTING_STATUS[k].label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="e-comment">Комментарий</Label>
        <Textarea id="e-comment" name="comment" rows={5} maxLength={5000} defaultValue={defaults.comment} />
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Сохраняем…" : "Сохранить"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
