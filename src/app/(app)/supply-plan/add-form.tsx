"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { addSupplyPlanEntry, type FormState } from "./actions";
import { STATUS_LABELS } from "./status";

const initialState: FormState = {};

export function AddSupplyPlanForm({ models }: { models: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(addSupplyPlanEntry, initialState);
  const thisMonth = new Date().toISOString().slice(0, 7);

  return (
    <form action={formAction} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 items-end gap-2">
      <div>
        <Label htmlFor="productModelId">Артикул</Label>
        <Select id="productModelId" name="productModelId" required defaultValue="">
          <option value="" disabled>
            Выберите
          </option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="month">Месяц</Label>
        <Input id="month" name="month" type="month" defaultValue={thisMonth} required />
      </div>
      <div>
        <Label htmlFor="status">Статус</Label>
        <Select id="status" name="status" defaultValue="PLANNED">
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="quantity">Кол-во</Label>
        <Input id="quantity" name="quantity" type="number" step="1" min="1" max="1000000" required />
      </div>
      <div>
        <Label htmlFor="eventDate">Дата</Label>
        <Input id="eventDate" name="eventDate" type="date" />
      </div>
      <div>
        <Label htmlFor="notes">Заметка</Label>
        <Input id="notes" name="notes" />
      </div>
      {state.error && <p className="col-span-2 sm:col-span-3 lg:col-span-6 text-sm text-red-600">{state.error}</p>}
      <div className="col-span-2 sm:col-span-3 lg:col-span-6 flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Добавляем..." : "+ Добавить в план"}
        </Button>
      </div>
    </form>
  );
}
