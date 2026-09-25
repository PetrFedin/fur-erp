"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { addMaterialUsagesBulk, type BulkUsageState } from "../actions";

const initialState: BulkUsageState = {};

export function BulkUsageForm({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const bound = addMaterialUsagesBulk.bind(null, orderId);
  const [state, formAction, pending] = useActionState(bound, initialState);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-left text-xs text-neutral-500 hover:underline">
        Списать сразу несколько лотов из таблицы →
      </button>
    );
  }

  return (
    <div className="rounded-md border border-dashed border-neutral-300 p-3">
      <p className="mb-2 text-xs text-neutral-500">
        Вставьте строки «Лот [Tab] Количество», по одной паре на строку — как в столбцах Лот/Кол-во исходной таблицы.
      </p>
      <form action={formAction} className="flex flex-col gap-2">
        <Textarea name="rows" rows={5} placeholder={"15874\t21\n15893\t10\n..."} className="font-mono text-xs" />
        <div className="flex items-center gap-2">
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            {pending ? "Списываем..." : "Списать все строки"}
          </Button>
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-neutral-400 hover:underline">
            Скрыть
          </button>
          {state.created !== undefined && (
            <span className="text-xs text-emerald-600">Списано позиций: {state.created}</span>
          )}
        </div>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state.skipped && state.skipped.length > 0 && (
          <p className="text-xs text-amber-600">
            Не удалось (нет такого лота, или не хватает остатка): {state.skipped.length} — {state.skipped.slice(0, 3).join(" | ")}
            {state.skipped.length > 3 ? "…" : ""}
          </p>
        )}
      </form>
    </div>
  );
}
