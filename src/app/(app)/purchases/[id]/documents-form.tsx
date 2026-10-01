"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { uploadPurchaseDocuments, type DocFormState } from "../doc-actions";

const KINDS: [string, string][] = [
  ["AUCTION_INVOICE", "Счёт аукциона"],
  ["SPECIFICATION", "Спецификация"],
  ["ADVANCE_INVOICE", "Счёт на аванс"],
  ["CALC_SHEET", "Расчётный лист"],
  ["UPD", "УПД / акт"],
  ["OTHER", "Другое"],
];

export function DocumentsForm({ purchaseId, hasBatch }: { purchaseId: string; hasBatch: boolean }) {
  const [state, action, pending] = useActionState(uploadPurchaseDocuments.bind(null, purchaseId), {} as DocFormState);
  const field = "h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm shadow-sm";
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        Файлы (PDF, XLSX, DOCX, JPEG, PNG)
        <input type="file" name="files" multiple required className="text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        Тип
        <select name="kind" defaultValue="AUCTION_INVOICE" className={field}>
          {KINDS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        К чему относится
        <select name="scope" defaultValue="purchase" className={field}>
          <option value="purchase">Только к этой закупке</option>
          {hasBatch && <option value="batch">Ко всей партии (аукцион)</option>}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        Название (необязательно)
        <input name="title" maxLength={200} className={`${field} w-48`} />
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Загружаем…" : "Загрузить"}
      </Button>
      {state.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
      {state.ok && <p className="w-full text-sm text-emerald-600">Загружено</p>}
    </form>
  );
}
