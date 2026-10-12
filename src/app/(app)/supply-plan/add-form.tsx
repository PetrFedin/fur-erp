"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { addSupplyPlanEntry, type FormState } from "./actions";
import { STATUS_LABELS } from "./status";
import { useKeepingForm } from "@/lib/use-keeping-form";

const LBL = "text-[10px] font-semibold uppercase tracking-wide text-neutral-500";
const initialState: FormState = {};

export function AddSupplyPlanForm({ models }: { models: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(addSupplyPlanEntry, initialState);
  const { setForm: keepRef, onSubmit: keepSubmit } = useKeepingForm(formAction, state, pending, true);
  const thisMonth = new Date().toISOString().slice(0, 7);

  return (
    <form ref={keepRef} onSubmit={keepSubmit} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 items-end gap-2">
      <div>
        <Label htmlFor="productModelId" className={LBL}>Артикул</Label>
        <Select id="productModelId" name="productModelId" required defaultValue="" className="ui-field h-11 rounded-lg text-xs">
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
        <Label htmlFor="month" className={LBL}>Месяц</Label>
        <Input id="month" name="month" type="month" defaultValue={thisMonth} required className="ui-field h-11 rounded-lg text-xs" />
      </div>
      <div>
        <Label htmlFor="status" className={LBL}>Статус</Label>
        <Select id="status" name="status" defaultValue="PLANNED" className="ui-field h-11 rounded-lg text-xs">
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="quantity" className={LBL}>Кол-во, шт.</Label>
        <Input id="quantity" name="quantity" type="number" step="1" min="1" max="1000000" required className="ui-field h-11 rounded-lg text-xs" />
      </div>
      <div>
        <Label htmlFor="eventDate" className={LBL}>Дата</Label>
        <Input id="eventDate" name="eventDate" type="date" className="ui-field h-11 rounded-lg text-xs" />
      </div>
      <div>
        <Label htmlFor="notes" className={LBL}>Заметка</Label>
        <Input id="notes" name="notes" className="ui-field h-11 rounded-lg text-xs" />
      </div>
      {state.error && <p className="col-span-2 sm:col-span-3 lg:col-span-6 text-sm text-red-600">{state.error}</p>}
      <div className="col-span-2 sm:col-span-3 lg:col-span-6 flex justify-end">
        <Button type="submit" disabled={pending} className="btn-accent">
          {pending ? "Добавляем..." : "+ Добавить в план"}
        </Button>
      </div>
    </form>
  );
}
