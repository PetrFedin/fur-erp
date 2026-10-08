"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import type { FormState } from "../actions";
import type { Warehouse } from "@prisma/client";
import { BatchField } from "./batch-field";
import { ColorSelect, type ColorSelectOption } from "@/components/color-select";

const initialState: FormState = {};

type ModelOption = { id: string; name: string };
type ClientOption = { id: string; name: string };

export function OrderEditForm({
  action,
  models,
  warehouses,
  clients,
  batches,
  modelLocked,
  defaults,
  colorOptions,
  canAddColor,
}: {
  action: (formData: FormData) => Promise<FormState>;
  models: ModelOption[];
  warehouses: Warehouse[];
  clients: ClientOption[];
  batches: { id: string; label: string }[];
  modelLocked: boolean;
  colorOptions: ColorSelectOption[];
  canAddColor: boolean;
  defaults: {
    productModelId: string;
    productModelName: string;
    rawWarehouseId: string;
    finishedWarehouseId: string;
    plannedQuantity: string;
    color: string;
    colorRefId: string;
    size: string;
    materialDescription: string;
    lining: string;
    startDate: string;
    notes: string;
    clientId: string;
    batchId: string;
    contractNumber: string;
    workOrderNumber: string;
    workOrderDate: string;
    clientWorkPricePerUnit: string;
    /** Версия записи на момент открытия формы (защита от тихой перезаписи чужой правки). */
    version?: string;
  };
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<FormState>(initialState);
  if (!isEditing) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setIsEditing(true)}>
        Изменить
      </Button>
    );
  }

  return (
    <div className="order-last w-full basis-full">
    <Card>
      <CardHeader>
        <CardTitle>Изменение ТЗ</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          // onSubmit, а не action: React 19 стирает поля формы после action даже при ошибке — правки терялись.
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(async () => {
              const r = (await action(fd)) ?? {};
              setState(r);
              if (!r.error) setIsEditing(false);
            });
          }}
          className="grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          {defaults.version && <input type="hidden" name="_v" value={defaults.version} />}
          <div className="sm:col-span-2">
            <Label htmlFor="productModelId">Модель изделия</Label>
            {modelLocked ? (
              <>
                <input type="hidden" name="productModelId" value={defaults.productModelId} />
                <div className="flex h-9 items-center text-sm text-neutral-500">
                  {defaults.productModelName}
                </div>
                <p className="mt-1 text-xs text-amber-700">
                  По ТЗ уже списано сырьё или зафиксирован выпуск — модель изменить нельзя.
                </p>
              </>
            ) : (
              <Select id="productModelId" name="productModelId" required defaultValue={defaults.productModelId}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div>
            <Label htmlFor="materialDescription">Материал продукции</Label>
            <Input id="materialDescription" name="materialDescription" defaultValue={defaults.materialDescription} />
          </div>
          <div>
            <Label htmlFor="color">Цвет</Label>
            <ColorSelect id="color" refs={colorOptions} canCreate={canAddColor} defaultValue={defaults.color} defaultRefId={defaults.colorRefId} />
          </div>
          <div>
            <Label htmlFor="size">Размер</Label>
            <Input id="size" name="size" defaultValue={defaults.size} />
          </div>
          <div>
            <Label htmlFor="lining">Подкладка (описание из ТЗ)</Label>
            <Input id="lining" name="lining" defaultValue={defaults.lining} />
          </div>
          <div>
            <Label htmlFor="plannedQuantity">Плановое количество</Label>
            <Input
              id="plannedQuantity"
              name="plannedQuantity"
              type="number"
              step="1"
              min="1"
              required
              defaultValue={defaults.plannedQuantity}
            />
          </div>
          <div>
            <Label htmlFor="startDate">Дата начала</Label>
            <Input id="startDate" name="startDate" type="date" defaultValue={defaults.startDate} />
          </div>
          <div>
            <Label htmlFor="rawWarehouseId">Склад сырья (списание)</Label>
            <Select id="rawWarehouseId" name="rawWarehouseId" required defaultValue={defaults.rawWarehouseId}>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="finishedWarehouseId">Склад готовой продукции</Label>
            <Select
              id="finishedWarehouseId"
              name="finishedWarehouseId"
              required
              defaultValue={defaults.finishedWarehouseId}
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="sm:col-span-2 mt-2 border-t border-neutral-200 pt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
              Заказчик и ТЗ
            </p>
          </div>
          <div>
            <Label htmlFor="clientId">Заказчик</Label>
            <Select id="clientId" name="clientId" defaultValue={defaults.clientId}>
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
            <Input id="contractNumber" name="contractNumber" defaultValue={defaults.contractNumber} />
          </div>
          <div>
            <Label htmlFor="workOrderNumber">№ ТЗ</Label>
            <Input id="workOrderNumber" name="workOrderNumber" defaultValue={defaults.workOrderNumber} />
          </div>
          <div>
            <Label htmlFor="workOrderDate">Дата ТЗ</Label>
            <Input id="workOrderDate" name="workOrderDate" type="date" defaultValue={defaults.workOrderDate} />
          </div>
          <div>
            <Label htmlFor="clientWorkPricePerUnit">Стоимость работ за ед., ₽ (для заказчика)</Label>
            <Input
              id="clientWorkPricePerUnit"
              name="clientWorkPricePerUnit"
              type="number"
              step="0.01"
              min="0"
              defaultValue={defaults.clientWorkPricePerUnit}
            />
          </div>

          <div className="sm:col-span-2">
            <BatchField batches={batches} defaultBatchId={defaults.batchId} />
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="notes">Заметки</Label>
            <Textarea id="notes" name="notes" rows={2} defaultValue={defaults.notes} />
          </div>

          {state.error && (
            <p className="sm:col-span-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
          )}
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setIsEditing(false)}>
              Закрыть
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Сохраняем..." : "Сохранить"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
    </div>
  );
}
