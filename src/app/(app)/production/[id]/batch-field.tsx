"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import type { FormState } from "../actions";

export type BatchOption = { id: string; label: string };

/**
 * Поле «Партия» ТЗ — заметный блок: выбрать из списка (с годами) ИЛИ ввести новый номер (партия создаётся при сохранении).
 * Пока партия не задана — жёлтая подсветка и подсказка «Партия не указана — выберите или введите».
 * Поля формы: batchId (выбор) и batchNumber (новый номер; если заполнен — главнее выбора).
 */
export function BatchField({ batches, defaultBatchId, idPrefix = "" }: { batches: BatchOption[]; defaultBatchId: string; idPrefix?: string }) {
  const [batchId, setBatchId] = useState(defaultBatchId);
  const [newNumber, setNewNumber] = useState("");
  const empty = !batchId && !newNumber.trim();
  return (
    <div
      id={`${idPrefix}batch`}
      className={
        "scroll-mt-4 rounded-lg border-2 p-3 " +
        (empty ? "border-amber-400 bg-amber-50" : "border-sky-300 bg-sky-50")
      }
    >
      <Label htmlFor={`${idPrefix}batchId`} className="text-sm font-semibold">Партия (поставка)</Label>
      {empty && <p className="mb-2 text-sm font-medium text-amber-800">Партия не указана — выберите или введите</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Select id={`${idPrefix}batchId`} name="batchId" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
            <option value="">Без партии</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-neutral-500">Выбрать из списка (с годом)</p>
        </div>
        <div>
          <Input
            id={`${idPrefix}batchNumber`}
            name="batchNumber"
            inputMode="numeric"
            pattern="\d{1,4}"
            maxLength={4}
            placeholder="Новый номер, например 22"
            value={newNumber}
            onChange={(e) => setNewNumber(e.target.value.replace(/\D/g, ""))}
            aria-label="Номер новой партии"
          />
          <p className="mt-1 text-xs text-neutral-500">…или ввести номер: партия будет создана, если её ещё нет</p>
        </div>
      </div>
      <p className="mt-2 text-xs text-neutral-600">
        После сохранения пересчитываются итоги партии, оплаты работы (оплата в партии отмечается по партии, а не на ТЗ) и сводки.
      </p>
    </div>
  );
}

/** Блок «Партия» на карточке ТЗ: текущая партия со ссылкой или жёлтая форма назначения; сохраняется сразу, без общей формы «Изменить». */
export function OrderBatchBlock({
  action,
  batches,
  current,
}: {
  action: (formData: FormData) => Promise<FormState>;
  batches: BatchOption[];
  current: { id: string; number: number; label: string } | null;
}) {
  const [editing, setEditing] = useState(!current);
  const [pending, start] = useTransition();
  const [state, setState] = useState<FormState>({});

  if (!editing && current) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-sky-300 bg-sky-50 px-3 py-2 text-sm">
        <span className="font-semibold">Партия пошива:</span>
        <a href={`/production/batches/${current.number}`} className="font-medium text-blue-700 underline-offset-2 hover:underline">
          {current.label}
        </a>
        <button type="button" onClick={() => setEditing(true)} className="ml-auto rounded border border-sky-300 bg-white px-2 py-1 text-xs hover:bg-sky-100">
          Изменить партию
        </button>
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = (await action(fd)) ?? {};
          setState(r);
          if (!r.error) setEditing(false);
        });
      }}
      className="flex flex-col gap-2"
    >
      <BatchField batches={batches} defaultBatchId={current?.id ?? ""} idPrefix="card-" />
      {state.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Сохраняем..." : "Сохранить партию"}
        </Button>
        {current && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Отмена
          </Button>
        )}
      </div>
    </form>
  );
}
