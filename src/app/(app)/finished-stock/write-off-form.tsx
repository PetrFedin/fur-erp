"use client";

import { useActionState } from "react";
import { useKeepingForm } from "@/lib/use-keeping-form";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { writeOffFinishedGoods, type WriteOffState } from "./actions";
import type { Warehouse } from "@prisma/client";

const initialState: WriteOffState = {};

type ModelOption = { id: string; name: string };

export function WriteOffForm({
  models,
  warehouses,
}: {
  models: ModelOption[];
  warehouses: Warehouse[];
}) {
  const [state, formAction, pending] = useActionState(writeOffFinishedGoods, initialState);
  const { setForm: keepRef, onSubmit: keepSubmit } = useKeepingForm(formAction, state, pending, true);

  return (
    <form
      ref={keepRef}
      onSubmit={(e) => {
        if (!window.confirm("Списать готовую продукцию со склада? Остаток уменьшится.")) {
          e.preventDefault();
          return;
        }
        keepSubmit(e);
      }}
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 items-end gap-2">
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Склад</label>
        <Select name="warehouseId" required defaultValue="">
          <option value="" disabled>
            Выберите склад
          </option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Модель</label>
        <Select name="productModelId" required defaultValue="">
          <option value="" disabled>
            Выберите модель
          </option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Количество</label>
        <Input name="quantity" type="number" step="1" min="1" required />
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-500">Причина</label>
        <Input name="notes" placeholder="Продажа, брак..." />
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Списываем..." : "Списать со склада"}
      </Button>
      {state.error && <p className="sm:col-span-2 lg:col-span-5 text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
