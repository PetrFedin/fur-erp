"use client";

import { useActionState, useRef } from "react";
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
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(async (prev: WriteOffState, formData: FormData) => {
    const result = await writeOffFinishedGoods(prev, formData);
    if (!result.error) formRef.current?.reset();
    return result;
  }, initialState);

  return (
    <form ref={formRef} action={formAction} className="grid grid-cols-5 items-end gap-2">
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
      {state.error && <p className="col-span-5 text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
