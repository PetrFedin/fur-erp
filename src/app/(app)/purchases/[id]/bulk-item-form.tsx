"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { addPurchaseItemsBulk, type BulkFormState } from "../actions";

const initialState: BulkFormState = {};

export function BulkItemForm({ purchaseId }: { purchaseId: string }) {
  const [open, setOpen] = useState(false);
  const bound = addPurchaseItemsBulk.bind(null, purchaseId);
  const [state, formAction, pending] = useActionState(bound, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-left text-xs text-neutral-500 hover:underline">
        Вставить сразу несколько позиций из таблицы →
      </button>
    );
  }

  return (
    <div className="rounded-md border border-dashed border-neutral-300 p-3">
      <p className="mb-2 text-xs text-neutral-500">
        Вставьте строки, скопированные из Excel — по одной позиции на строку, столбцы через Tab:{" "}
        <span className="font-mono">Материал, Кол-во, Цена без НДС, НДС% (необязательно), Лот, Сорт, Цвет</span>.
        Сырьё с новым названием будет создано автоматически.
      </p>
      <form
        ref={formRef}
        action={(fd) => {
          formAction(fd);
        }}
        className="flex flex-col gap-2"
      >
        <Textarea
          name="rows"
          rows={6}
          placeholder={"Соболь дикий выделанный\t21\t60355.15\t22\t15874\tК 2 (1.2.5)\n..."}
          className="font-mono text-xs"
        />
        <div className="flex items-center gap-2">
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            {pending ? "Добавляем..." : "Добавить все строки"}
          </Button>
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-neutral-400 hover:underline">
            Скрыть
          </button>
          {state.created !== undefined && (
            <span className="text-xs text-emerald-600">Добавлено позиций: {state.created}</span>
          )}
        </div>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state.skipped && state.skipped.length > 0 && (
          <p className="text-xs text-amber-600">
            Не распознано строк: {state.skipped.length} — {state.skipped.slice(0, 3).join(" | ")}
            {state.skipped.length > 3 ? "…" : ""}
          </p>
        )}
      </form>
    </div>
  );
}
