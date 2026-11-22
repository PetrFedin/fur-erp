"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  deletePurchaseDocument,
  updatePurchaseDocument,
} from "../purchases/doc-actions";

const KINDS: [string, string][] = [
  ["AUCTION_INVOICE", "Счёт аукциона"],
  ["SPECIFICATION", "Спецификация"],
  ["ADVANCE_INVOICE", "Счёт на аванс"],
  ["CALC_SHEET", "Расчётный лист"],
  ["UPD", "УПД / акт"],
  ["PAYMENT_PROOF", "Платёжный документ"],
  ["OTHER", "Другое"],
];
const field = "ui-field h-8 rounded-md border border-neutral-300 bg-white px-2 text-sm shadow-sm";

/** «Свернуть / развернуть все закупки» — переключает все <details data-auction-purchase> на странице. */
export function ToggleAllPurchases() {
  const [allOpen, setAllOpen] = useState(false);
  const label = allOpen ? "Свернуть все закупки" : "Развернуть все закупки";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        const next = !allOpen;
        document.querySelectorAll<HTMLDetailsElement>("details[data-auction-purchase]").forEach((d) => (d.open = next));
        setAllOpen(next);
      }}
      className="inline-flex size-9 items-center justify-center rounded-lg border border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-900"
    >
      <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {allOpen ? <path d="M4 5.5 8 2l4 3.5M4 10.5 8 14l4-3.5" /> : <path d="M4 3.5 8 7l4-3.5M4 12.5 8 9l4 3.5" />}
      </svg>
    </button>
  );
}

/** Кнопки правки документа: заменить файл, переименовать / сменить тип, удалить (с подтверждением). */
export function DocEditControls({
  documentId,
  purchaseId,
  title,
  kind,
  isBatch,
  batchName,
}: {
  documentId: string;
  /** Закупка, на странице которой документ показан (для revalidate); у документа партии — любая закупка аукциона. */
  purchaseId: string;
  title: string;
  kind: string;
  isBatch: boolean;
  batchName: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});

  function run(fn: () => Promise<{ error?: string; ok?: boolean } | void>, okText: string, after?: () => void) {
    setMsg({});
    startTransition(async () => {
      try {
        const res = await fn();
        if (res && res.error) setMsg({ error: res.error });
        else {
          setMsg({ ok: okText });
          after?.();
          router.refresh();
        }
      } catch {
        setMsg({ error: "Не удалось выполнить действие: сервер отклонил запрос или пропала связь." });
      }
    });
  }

  function onRename(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() => updatePurchaseDocument(documentId, fd), "Сохранено", () => setRenaming(false));
  }

  function onDelete() {
    const text = isBatch
      ? `Удалить документ «${title}»? Он относится ко всей партии ${batchName ?? ""} и пропадёт на всех её закупках.`
      : `Удалить документ «${title}»?`;
    if (!window.confirm(text)) return;
    run(() => deletePurchaseDocument(purchaseId, documentId), "Удалено");
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setRenaming((v) => !v)}>
          Переименовать
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onDelete}>
          Удалить
        </Button>
      </div>
      {renaming && (
        <form onSubmit={onRename} className="flex flex-wrap items-center gap-1">
          <input name="title" defaultValue={title} maxLength={200} required className={`${field} w-56 max-w-full`} />
          <select name="kind" defaultValue={kind} className={field}>
            {KINDS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" disabled={pending}>
            Сохранить
          </Button>
        </form>
      )}
      {pending && <span className="text-xs text-neutral-500">Выполняем…</span>}
      {msg.error && <span className="text-xs text-red-600">{msg.error}</span>}
      {msg.ok && <span className="text-xs text-emerald-700">{msg.ok}</span>}
    </div>
  );
}
