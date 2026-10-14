"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { SUPPLIER_DOC_TYPES } from "@/lib/supplier-docs";
import { attachDocument, type AttachState } from "./actions";

/** Кнопка и форма «Приложить документ» к закупке (itemId пусто) или к лоту. */
export function AttachDocument({ purchaseId, itemId, label }: { purchaseId: string; itemId?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<AttachState, FormData>(attachDocument, {});
  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>{label ?? "Приложить документ"}</Button>
    );
  }
  return (
    <form action={action} className="flex min-w-64 flex-col gap-2 rounded-md border border-neutral-300 bg-white p-3 text-sm">
      <input type="hidden" name="purchaseId" value={purchaseId} />
      {itemId && <input type="hidden" name="itemId" value={itemId} />}
      <label className="flex flex-col gap-1">Тип
        <select name="docType" className="h-9 rounded-md border border-neutral-300 px-2">
          {SUPPLIER_DOC_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">Номер
        <input name="number" maxLength={60} className="h-9 rounded-md border border-neutral-300 px-2" />
      </label>
      <label className="flex flex-col gap-1">Дата
        <input name="date" type="date" className="h-9 rounded-md border border-neutral-300 px-2" />
      </label>
      <label className="flex flex-col gap-1">Комментарий
        <textarea name="comment" rows={2} maxLength={1000} className="rounded-md border border-neutral-300 p-2" />
      </label>
      <label className="flex flex-col gap-1">Файл (PDF, XLSX, DOCX, JPEG, PNG)
        <input name="files" type="file" multiple required accept=".pdf,.xlsx,.docx,.jpg,.jpeg,.png" />
      </label>
      {state.error && <p role="alert" className="text-red-700">{state.error}</p>}
      {state.ok && <p role="status" className="text-green-800">Отправлено нам. После проверки документ появится у закупки.</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>{pending ? "Отправляю…" : "Отправить"}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Закрыть</Button>
      </div>
    </form>
  );
}
