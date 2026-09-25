"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import type { FormState } from "../actions";
import type { Warehouse } from "@prisma/client";

const initialState: FormState = {};

type ModelOption = { id: string; name: string };
type ClientOption = { id: string; name: string };

export function ProductionCreateForm({
  action,
  models,
  warehouses,
  clients,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  models: ModelOption[];
  warehouses: Warehouse[];
  clients: ClientOption[];
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
        <Label htmlFor="color">Цвет</Label>
        <Input id="color" name="color" placeholder="Коричневый" />
      </div>
      <div>
        <Label htmlFor="size">Размер</Label>
        <Input id="size" name="size" placeholder="42, 44" />
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

      <div className="col-span-2 mt-2 border-t border-neutral-200 pt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
          Заказчик и ТЗ (если производство по договору подряда)
        </p>
      </div>
      <div>
        <Label htmlFor="clientId">Заказчик</Label>
        <Select id="clientId" name="clientId" defaultValue="">
          <option value="">Собственное производство</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="contractNumber">№ и дата договора подряда</Label>
        <Input id="contractNumber" name="contractNumber" placeholder="№ 1605 от 16.05.2025" />
      </div>
      <div>
        <Label htmlFor="workOrderNumber">№ ТЗ</Label>
        <Input id="workOrderNumber" name="workOrderNumber" placeholder="141" />
      </div>
      <div>
        <Label htmlFor="workOrderDate">Дата ТЗ</Label>
        <Input id="workOrderDate" name="workOrderDate" type="date" />
      </div>
      <div>
        <Label htmlFor="clientWorkPricePerUnit">Стоимость работ за ед., ₽ (для заказчика)</Label>
        <Input id="clientWorkPricePerUnit" name="clientWorkPricePerUnit" type="number" step="0.01" min="0" />
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
