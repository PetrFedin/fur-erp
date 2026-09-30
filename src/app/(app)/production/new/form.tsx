"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import type { CreateOrderState } from "../actions";
import type { Warehouse } from "@prisma/client";

const initialState: CreateOrderState = {};

type ModelOption = { id: string; name: string };
type ClientOption = { id: string; name: string };
type LiningOption = { id: string; name: string; remaining: string };

export function ProductionCreateForm({
  action,
  models,
  warehouses,
  clients,
  liningOptions,
  lastContractByClient,
}: {
  action: (prev: CreateOrderState, formData: FormData) => Promise<CreateOrderState>;
  models: ModelOption[];
  warehouses: Warehouse[];
  clients: ClientOption[];
  liningOptions: LiningOption[];
  lastContractByClient: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const today = new Date().toISOString().slice(0, 10);
  const defaultWarehouse = warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? "";

  // Controlled values: React 19 resets uncontrolled fields after a server
  // action, which would wipe a long lot paste when an error comes back.
  const [modelText, setModelText] = useState("");
  const [contract, setContract] = useState("");
  const [contractTouched, setContractTouched] = useState(false);
  const [clientId, setClientId] = useState("");
  const [f, setF] = useState<Record<string, string>>({ startDate: today });
  const set = (k: string) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  const modelId = models.find((m) => m.name.toLowerCase() === modelText.trim().toLowerCase())?.id ?? "";
  const errors = state.errors ?? (state.error ? [state.error] : []);

  return (
    <form action={formAction} className="grid grid-cols-2 gap-4">
      <input type="hidden" name="productModelId" value={modelId} />
      <div className="col-span-2">
        <Label htmlFor="modelText">Модель изделия</Label>
        <Input
          id="modelText"
          list="model-options"
          value={modelText}
          onChange={(e) => setModelText(e.target.value)}
          placeholder="Начните вводить название модели"
          autoComplete="off"
          required
        />
        <datalist id="model-options">
          {models.map((m) => (
            <option key={m.id} value={m.name} />
          ))}
        </datalist>
        {modelText && !modelId && (
          <p className="mt-1 text-xs text-amber-600">Выберите модель из списка подсказок (точное название).</p>
        )}
      </div>
      <div>
        <Label htmlFor="plannedQuantity">Количество, шт</Label>
        <Input
          id="plannedQuantity"
          name="plannedQuantity"
          type="number"
          step="1"
          min="1"
          required
          value={f.plannedQuantity ?? ""}
          onChange={set("plannedQuantity")}
        />
      </div>
      <div>
        <Label htmlFor="size">Размеры</Label>
        <Input id="size" name="size" placeholder="42, 44" value={f.size ?? ""} onChange={set("size")} />
      </div>
      <div>
        <Label htmlFor="clientWorkPricePerUnit">Стоимость работ за ед., ₽</Label>
        <Input
          id="clientWorkPricePerUnit"
          name="clientWorkPricePerUnit"
          type="number"
          step="0.01"
          min="0"
          value={f.clientWorkPricePerUnit ?? ""}
          onChange={set("clientWorkPricePerUnit")}
        />
      </div>
      <div>
        <Label htmlFor="workOrderNumber">№ ТЗ</Label>
        <Input
          id="workOrderNumber"
          name="workOrderNumber"
          placeholder="141"
          value={f.workOrderNumber ?? ""}
          onChange={set("workOrderNumber")}
        />
      </div>
      <div className="col-span-2">
        <Label htmlFor="clientId">Заказчик</Label>
        <Select
          id="clientId"
          name="clientId"
          value={clientId}
          onChange={(e) => {
            const id = e.target.value;
            setClientId(id);
            if (!contractTouched) setContract(lastContractByClient[id] ?? "");
          }}
        >
          <option value="">Собственное производство</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="col-span-2 rounded-md border border-neutral-200 p-3">
        <Label htmlFor="lots">Лоты меха</Label>
        <Textarea
          id="lots"
          name="lots"
          rows={8}
          className="font-mono"
          placeholder={"344\t12\n1330\t5,5"}
          value={f.lots ?? ""}
          onChange={set("lots")}
        />
        <p className="mt-1 text-xs text-neutral-500">
          Из Excel: <b>лот</b> [Tab] <b>кол-во</b>, по строке на лот. Одна неверная строка — ТЗ не создастся.
        </p>
      </div>

      <div className="col-span-2 rounded-md border border-neutral-200 p-3">
        <p className="mb-2 text-sm font-medium text-neutral-700">Подкладка</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="liningMaterialId">Ткань подкладки</Label>
            <Select
              id="liningMaterialId"
              name="liningMaterialId"
              value={f.liningMaterialId ?? ""}
              onChange={set("liningMaterialId")}
            >
              <option value="">Не списывать сейчас</option>
              {liningOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} — остаток {o.remaining} м
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="liningQuantity">Метраж, м</Label>
            <Input
              id="liningQuantity"
              name="liningQuantity"
              type="number"
              step="0.01"
              min="0"
              value={f.liningQuantity ?? ""}
              onChange={set("liningQuantity")}
            />
          </div>
        </div>
      </div>

      <details className="col-span-2 rounded-md border border-neutral-200 p-3">
        <summary className="cursor-pointer text-sm font-medium text-neutral-700">Дополнительно</summary>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="color">Цвет</Label>
            <Input id="color" name="color" placeholder="Коричневый" value={f.color ?? ""} onChange={set("color")} />
          </div>
          <div>
            <Label htmlFor="materialDescription">Материал продукции (описание)</Label>
            <Input
              id="materialDescription"
              name="materialDescription"
              placeholder="Соболь выделанный тонированный"
              value={f.materialDescription ?? ""}
              onChange={set("materialDescription")}
            />
          </div>
          <div>
            <Label htmlFor="lining">Описание подкладки из ТЗ (справка)</Label>
            <Input
              id="lining"
              name="lining"
              placeholder="100% Шёлк, № LC1635 (№8)"
              value={f.lining ?? ""}
              onChange={set("lining")}
            />
          </div>
          <div>
            <Label htmlFor="contractNumber">№ и дата договора подряда</Label>
            <Input
              id="contractNumber"
              name="contractNumber"
              placeholder="№ 1605 от 16.05.2025"
              value={contract}
              onChange={(e) => {
                setContract(e.target.value);
                setContractTouched(true);
              }}
            />
          </div>
          <div>
            <Label htmlFor="workOrderDate">Дата ТЗ</Label>
            <Input
              id="workOrderDate"
              name="workOrderDate"
              type="date"
              value={f.workOrderDate ?? ""}
              onChange={set("workOrderDate")}
            />
          </div>
          <div>
            <Label htmlFor="startDate">Дата начала</Label>
            <Input id="startDate" name="startDate" type="date" value={f.startDate ?? ""} onChange={set("startDate")} />
          </div>
          <div>
            <Label htmlFor="rawWarehouseId">Склад сырья (списание)</Label>
            <Select
              id="rawWarehouseId"
              name="rawWarehouseId"
              value={f.rawWarehouseId ?? defaultWarehouse}
              onChange={set("rawWarehouseId")}
            >
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
              value={f.finishedWarehouseId ?? defaultWarehouse}
              onChange={set("finishedWarehouseId")}
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="col-span-2">
            <Label htmlFor="notes">Заметки</Label>
            <Textarea id="notes" name="notes" rows={2} value={f.notes ?? ""} onChange={set("notes")} />
          </div>
        </div>
      </details>

      {errors.length > 0 && (
        <ul className="col-span-2 list-disc rounded-md bg-red-50 px-6 py-2 text-sm text-red-700">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      <div className="col-span-2 flex justify-end">
        <Button type="submit" disabled={pending || !modelId}>
          {pending ? "Создаём..." : "Создать ТЗ"}
        </Button>
      </div>
    </form>
  );
}
