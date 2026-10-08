"use client";

import { useState, useTransition } from "react";
import { Select } from "@/components/ui/input";
import { AMOUNT_KINDS, DOC_KINDS, type BatchPreview, type DocKindKey } from "@/lib/batch-intake";
import { recognizeDocuments } from "./actions";
import type { DocState } from "./shared";

const cell = "h-8 w-full rounded border border-neutral-300 bg-white px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400";
const MAX_TOTAL = 25 * 1024 * 1024;

export function DocsStep({
  docs,
  setDocs,
  preview,
}: {
  docs: DocState[];
  setDocs: (d: DocState[] | ((p: DocState[]) => DocState[])) => void;
  preview: BatchPreview | null;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    setMsg(null);
    if (docs.length + files.length > 10) return setMsg("Можно приложить не больше 10 документов за одну партию — остальные загрузите в закупках позже.");
    if (docs.reduce((s, d) => s + d.size, 0) + files.reduce((s, f) => s + f.size, 0) > MAX_TOTAL) return setMsg("Суммарный размер документов больше 25 МБ — загрузите часть позже в карточке закупки.");
    start(async () => {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      let res;
      try {
        res = await recognizeDocuments(fd);
      } catch {
        return setMsg("Не удалось отправить файлы. Проверьте соединение и повторите.");
      }
      if ("error" in res) return setMsg(res.error);
      setDocs((prev) => [
        ...prev,
        ...res.docs.map((d, i) => ({ ...d, id: `${Date.now()}-${prev.length + i}`, file: files[i] })),
      ]);
    });
  }

  const patch = (id: string, p: Partial<DocState>) => setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, ...p } : d)));
  const found = docs.filter((d) => d.kind !== "OTHER");

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-neutral-600">
        Загрузите пачку документов партии: счёт, УПД, инвойс, расчётный лист, спецификацию (PDF, Excel, Word, JPG/PNG, до 10 файлов, всего до 25 МБ). Тип, номер, дату и сумму определим по имени и тексту — вы сможете поправить. Этот шаг можно пропустить: документы загружаются и позже.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" multiple accept=".pdf,.xlsx,.docx,.jpg,.jpeg,.png" aria-label="Документы партии" disabled={pending} onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
        {pending && <span className="text-xs text-neutral-500">Распознаём…</span>}
      </div>
      {msg && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{msg}</p>}

      {docs.length > 0 && (
        <p className="rounded-md bg-neutral-50 px-3 py-2">
          <b>Найдено:</b>{" "}
          {found.length === 0
            ? "типы документов не определены — выберите вручную"
            : found.map((d) => `${DOC_KINDS.find((k) => k.key === d.kind)?.label.toLowerCase()}${d.number ? ` №${d.number}` : ""}`).join(", ")}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {docs.map((d, i) => {
          const r = preview?.docs.find((x) => x.idx === i);
          return (
            <div key={d.id} className="rounded-md border border-neutral-200 p-3" data-doc-card>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{d.name}</div>
                  <div className="text-xs text-neutral-500">{(d.size / 1024).toFixed(0)} КБ{d.textRead ? " · текст прочитан" : " · текст не прочитан"}</div>
                </div>
                <button type="button" className="text-neutral-500 hover:text-red-600" aria-label={`Убрать документ ${d.name}`} onClick={() => setDocs((prev) => prev.filter((x) => x.id !== d.id))}>
                  ×
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="col-span-2 flex flex-col gap-0.5 text-xs text-neutral-600 sm:col-span-1">
                  Тип
                  <Select className="h-8 px-1 text-xs" value={d.kind} onChange={(e) => patch(d.id, { kind: e.target.value as DocKindKey })}>
                    {DOC_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                  </Select>
                </label>
                <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
                  Номер
                  <input className={cell} value={d.number} onChange={(e) => patch(d.id, { number: e.target.value })} />
                </label>
                <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
                  Дата
                  <input className={cell} type="date" value={d.date} onChange={(e) => patch(d.id, { date: e.target.value })} />
                </label>
                <label className="flex flex-col gap-0.5 text-xs text-neutral-600">
                  Сумма, ₽ {AMOUNT_KINDS.includes(d.kind) ? "" : "(не сверяется)"}
                  <input className={cell + " text-right"} inputMode="decimal" value={d.amount} onChange={(e) => patch(d.id, { amount: e.target.value })} />
                </label>
              </div>
              {d.notes.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-neutral-500">{d.notes.map((n, j) => <li key={j}>{n}</li>)}</ul>}
              {r?.recon && (
                <div className={"mt-2 rounded-md px-3 py-2 text-xs " + (r.recon.ok ? "bg-green-50 text-green-900" : "bg-amber-50 text-amber-900")} data-recon={r.recon.ok ? "ok" : "diff"}>
                  <div className="font-medium">{r.recon.ok ? "Сумма сходится" : "Сумма расходится"} (сверка: {r.against})</div>
                  <div>{r.recon.message}</div>
                  {r.recon.reasons.map((x, j) => <div key={j} className="mt-1">Возможная причина — {x}</div>)}
                </div>
              )}
              {r && !r.recon && r.note && <div className="mt-2 text-xs text-neutral-500">{r.note}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
