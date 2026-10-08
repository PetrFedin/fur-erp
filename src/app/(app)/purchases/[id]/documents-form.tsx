"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { formatMb } from "@/lib/format-mb";
import { uploadPurchaseDocuments, type DocFormState } from "../doc-actions";
import { uploadDriveDocument } from "../../drive-actions";
import { guessDocType } from "@/lib/drive-docs";
import { clientFileError } from "@/components/drive-documents";

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

export function DocumentsForm({
  purchaseId,
  hasBatch,
  paymentTargets,
}: {
  purchaseId: string;
  hasBatch: boolean;
  /** Оплаты закупки: документ можно привязать к оплате (платёжка, письмо) — сохраняется как документ Drive. */
  paymentTargets?: { id: string; label: string }[];
}) {
  const [state, setState] = useState<DocFormState>({});
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState("AUCTION_INVOICE");
  const field = "h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm shadow-sm";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    for (const f of fd.getAll("files")) {
      if (typeof f !== "string" && f.name !== "" && f.name !== "undefined" && f.size > 0) {
        const bad = clientFileError(f);
        if (bad) {
          setState({ error: bad });
          return;
        }
      }
    }
    const files = fd.getAll("files").filter((f): f is File => typeof f !== "string" && f.size > 0);
    const picked = fd.getAll("files").filter((f): f is File => typeof f !== "string" && f.name !== "" && f.name !== "undefined");
    const scope = String(fd.get("scope") ?? "purchase");
    const payId = scope.startsWith("payment:") ? scope.slice("payment:".length) : null;
    if (payId && files.length > 1) {
      setState({ error: "К оплате — по одному файлу" });
      return;
    }
    if (files.length === 0 && picked.length > 0) {
      setState({ error: "Файл пустой (0 байт)" });
      return;
    }
    const total = files.reduce((s, f) => s + f.size, 0);
    if (total > MAX_TOTAL) {
      setState({ error: (files.length === 1 ? `Файл больше 25 МБ (${formatMb(total)} МБ)` : `Суммарный размер файлов ${formatMb(total)} МБ — больше лимита 25 МБ; загрузите файлы по частям`) });
      return;
    }
    setState({});
    startTransition(async () => {
      try {
        let res: DocFormState | void;
        if (payId) {
          const one = new FormData();
          one.set("file", files[0] ?? picked[0]);
          one.set("title", String(fd.get("title") ?? ""));
          one.set("docType", String(fd.get("kind") ?? "OTHER"));
          res = await uploadDriveDocument("payment", payId, one);
        } else {
          res = await uploadPurchaseDocuments(purchaseId, {}, fd);
        }
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
        Файлы (PDF, XLSX, DOCX, JPEG, PNG; до 10 за раз, всего до 25 МБ)
        <input
          type="file"
          name="files"
          multiple
          required
          accept=".pdf,.xlsx,.docx,.jpg,.jpeg,.png"
          className="text-sm"
          onChange={(e) => {
            const fs = Array.from(e.currentTarget.files ?? []);
            const g = fs.length === 1 ? guessDocType(fs[0].name) : null;
            if (g && KINDS.some(([v]) => v === g)) setKind(g);
          }}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-neutral-500">
        Тип
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={field}>
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
          {(paymentTargets ?? []).map((t) => (
            <option key={t.id} value={`payment:${t.id}`}>
              К оплате: {t.label}
            </option>
          ))}
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
      {state.ok && <p className="w-full text-sm text-emerald-700">Загружено</p>}
    </form>
  );
}

/** Кнопка «Удалить» в серверной форме: спрашивает подтверждение и отменяет отправку при отказе. */
export function ConfirmSubmitButton({
  message,
  label = "Удалить",
  variant = "ghost",
  className,
}: {
  message: string;
  label?: string;
  variant?: "ghost" | "outline" | "destructive";
  className?: string;
}) {
  return (
    <Button
      type="submit"
      variant={variant}
      size="sm"
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {label}
    </Button>
  );
}
