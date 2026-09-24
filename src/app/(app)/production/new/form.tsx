"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import type { FormState } from "../actions";
import type { ProductModel, Warehouse } from "@prisma/client";

const initialState: FormState = {};

export function ProductionCreateForm({
  action,
  models,
  warehouses,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  models: ProductModel[];
  warehouses: Warehouse[];
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const today = new Date().toISOString().slice(0, 10);
  const defaultWarehouse = warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? "";

  return (
    <form action={formAction} className="grid grid-cols-2 gap-4">
      <div className="col-span-2">
        <Label htmlFor="productModelId">Модель изделия</Label>
        <Select id="productModelId" name="productModelId" required defaultValue="">
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
        <Label htmlFor="plannedQuantity">Плановое количество</Label>
        <Input id="plannedQuantity" name="plannedQuantity" type="number" step="1" min="1" required />
      </div>
      <div>
        <Label htmlFor="startDate">Дата начала</Label>
        <Input id="startDate" name="startDate" type="date" defaultValue={today} />
      </div>
      <div>
        <Label htmlFor="rawWarehouseId">Склад сырья (списание)</Label>
        <Select id="rawWarehouseId" name="rawWarehouseId" required defaultValue={defaultWarehouse}>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="finishedWarehouseId">Склад готовой продукции</Label>
        <Select id="finishedWarehouseId" name="finishedWarehouseId" required defaultValue={defaultWarehouse}>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="col-span-2">
        <Label htmlFor="notes">Заметки</Label>
        <Textarea id="notes" name="notes" rows={2} />
      </div>
      {state.error && (
        <p className="col-span-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <div className="col-span-2 flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Создаём..." : "Создать заказ"}
        </Button>
      </div>
    </form>
  );
}
