"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { formatMb } from "@/lib/format-mb";
import { uploadPurchaseDocuments, type DocFormState } from "../doc-actions";

const KINDS: [string, string][] = [
  ["AUCTION_INVOICE", "Счёт аукциона"],
  ["SPECIFICATION", "Спецификация"],
  ["ADVANCE_INVOICE", "Счёт на аванс"],
  ["CALC_SHEET", "Расчётный лист"],
  ["UPD", "УПД / акт"],
  ["PAYMENT_PROOF", "Платёжный документ"],
  ["OTHER", "Другое"],
];

const MAX_TOTAL = 25 * 1024 * 1024;

export function DocumentsForm({ purchaseId, hasBatch }: { purchaseId: string; hasBatch: boolean }) {
  const [state, setState] = useState<DocFormState>({});
  const [pending, startTransition] = useTransition();
  const field = "h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm shadow-sm";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const files = fd.getAll("files").filter((f): f is File => typeof f !== "string" && f.size > 0);
    const total = files.reduce((s, f) => s + f.size, 0);
    if (total > MAX_TOTAL) {
      setState({ error: (files.length === 1 ? `Файл больше 25 МБ (${formatMb(total)} МБ)` : `Суммарный размер файлов ${formatMb(total)} МБ — больше лимита 25 МБ; загрузите файлы по частям`) });
      return;
    }
    setState({});
    startTransition(async () => {
      try {
        const res = await uploadPurchaseDocuments(purchaseId, {}, fd);
        setState(res ?? {});
        if (res?.ok) form.reset();
      } catch {
        // Запрос упал (слишком большой файл для сервера, обрыв связи, ошибка сервера) —
        // не оставляем вечное «Загружаем…».
        setState({ error: "Не удалось загрузить файл: сервер отклонил запрос (возможно, файл слишком большой) или пропала связь. Попробуйте ещё раз." });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        Файлы (PDF, XLSX, DOCX, JPEG, PNG; всего до 25 МБ)
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

/** Кнопка «Удалить» в серверной форме: спрашивает подтверждение и отменяет отправку при отказе. */
export function ConfirmSubmitButton({ message, label = "Удалить" }: { message: string; label?: string }) {
  return (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {label}
    </Button>
  );
}
