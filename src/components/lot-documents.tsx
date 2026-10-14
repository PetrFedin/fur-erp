"use client";

import { useRef, useState } from "react";
import { DocFileButtons } from "@/components/doc-preview";
import { useConfirm } from "@/components/confirm-dialog";
import { formatMb } from "@/lib/format-mb";
import { cn } from "@/lib/utils";
import { uploadLotDocuments, replaceLotDocument, deleteLotDocument } from "@/app/(app)/analytics/raw/lot/[id]/actions";
import { ICON_BTN_DANGER, IconTrash } from "@/components/icons";

export type LotDocRow = { id: string; kind: string; title: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: string };
export type InheritedDoc = { href: string | null; text: string };

const SLOTS: { kind: string; label: string; hint: string }[] = [
  { kind: "UPD", label: "УПД", hint: "универсальный передаточный документ" },
  { kind: "AUCTION_INVOICE", label: "Счёт", hint: "счёт на оплату лота" },
  { kind: "SPECIFICATION", label: "Спецификация", hint: "спецификация / приложение к договору" },
  { kind: "OTHER", label: "Другое", hint: "любой другой документ по лоту" },
];

const BTN = "h-7 rounded-md border border-neutral-300 px-2 text-xs hover:border-neutral-500 disabled:opacity-50";
const dateRu = (iso: string) => new Date(iso).toLocaleDateString("ru-RU");

function Slot({ lotId, kind, label, hint, docs, canEdit, onError }: { lotId: string; kind: string; label: string; hint: string; docs: LotDocRow[]; canEdit: boolean; onError: (e: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const repl = useRef<HTMLInputElement>(null);
  const replId = useRef<string | null>(null);
  const { ask, node } = useConfirm();

  const upload = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setBusy(true);
    onError(null);
    const fd = new FormData();
    fd.set("kind", kind);
    for (const f of arr) fd.append("files", f);
    try {
      const r = await uploadLotDocuments(lotId, fd);
      if (r.error) onError(r.error);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Не удалось загрузить файл");
    }
    setBusy(false);
  };
  const replace = async (file: File | undefined) => {
    const id = replId.current;
    if (!file || !id) return;
    setBusy(true);
    onError(null);
    const fd = new FormData();
    fd.set("file", file);
    try {
      const r = await replaceLotDocument(lotId, id, fd);
      if (r.error) onError(r.error);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Не удалось заменить файл");
    }
    replId.current = null;
    if (repl.current) repl.current.value = "";
    setBusy(false);
  };
  const remove = async (d: LotDocRow) => {
    if (!(await ask(`Удалить документ «${d.title}» из лота? Файл будет удалён.`, { ok: "Удалить", danger: true }))) return;
    setBusy(true);
    const r = await deleteLotDocument(lotId, d.id);
    if (r.error) onError(r.error);
    setBusy(false);
  };

  return (
    <div
      className={cn("flex flex-col gap-1.5 rounded-lg border bg-white p-3 transition-colors", over ? "border-orange-500 bg-orange-50/40" : "border-neutral-200")}
      onDragOver={canEdit ? (e) => { e.preventDefault(); setOver(true); } : undefined}
      onDragLeave={canEdit ? () => setOver(false) : undefined}
      onDrop={canEdit ? (e) => { e.preventDefault(); setOver(false); void upload(e.dataTransfer.files); } : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><span className="text-sm font-semibold">{label}</span> <span className="text-xs text-neutral-500">{hint}</span></div>
        {canEdit ? (
          <>
            <button type="button" className={BTN} disabled={busy} onClick={() => pick.current?.click()}>{docs.length ? "Добавить файл" : "Загрузить файл"}</button>
            <input ref={pick} type="file" multiple hidden accept=".pdf,.xlsx,.docx,.jpg,.jpeg,.png" aria-label={`Файл: ${label}`} onChange={(e) => { void upload(e.target.files ?? []); e.target.value = ""; }} />
          </>
        ) : null}
      </div>
      {docs.length === 0 ? (
        <p className="text-xs text-neutral-500">{canEdit ? "Файла нет — перетащите его сюда или нажмите «Загрузить файл». Номера и суммы заполнять не нужно." : "Файла нет"}</p>
      ) : (
        <ul className="flex list-none flex-col gap-1.5 p-0">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-col gap-1 border-t border-neutral-100 pt-1.5 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-sm">
                <span className="break-words font-medium">{d.title}</span>
                <span className="ml-2 text-xs text-neutral-500">{d.originalName !== d.title ? `${d.originalName} · ` : ""}{formatMb(d.sizeBytes)} МБ · {dateRu(d.createdAt)}</span>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <DocFileButtons href={`/api/purchase-docs/${d.id}`} mime={d.mimeType} title={d.title} />
                {canEdit ? (
                  <>
                    <button type="button" className={BTN} disabled={busy} onClick={() => { replId.current = d.id; repl.current?.click(); }}>Заменить</button>
                    <button type="button" className={ICON_BTN_DANGER} disabled={busy} onClick={() => void remove(d)} title="Удалить" aria-label="Удалить"><IconTrash /></button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canEdit ? <input ref={repl} type="file" hidden accept=".pdf,.xlsx,.docx,.jpg,.jpeg,.png" aria-label={`Заменить файл: ${label}`} onChange={(e) => void replace(e.target.files?.[0])} /> : null}
      {busy ? <span className="text-[11px] text-neutral-500" aria-live="polite">обрабатываем…</span> : null}
      {node}
    </div>
  );
}

/** «Документы» лота: слоты УПД / Счёт / Спецификация / Другое — загрузка (кнопка или перетаскивание), скачивание, замена, удаление. Поля документов не заполняются. */
export function LotDocuments({ lotId, docs, inherited, canEdit }: { lotId: string; docs: LotDocRow[]; inherited: InheritedDoc[]; canEdit: boolean }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {SLOTS.map((s) => (
          <Slot key={s.kind} lotId={lotId} kind={s.kind} label={s.label} hint={s.hint} docs={docs.filter((d) => (s.kind === "OTHER" ? !SLOTS.slice(0, 3).some((x) => x.kind === d.kind) : d.kind === s.kind))} canEdit={canEdit} onError={setError} />
        ))}
      </div>
      {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
      {inherited.length ? (
        <details className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm">
          <summary className="cursor-pointer text-xs text-neutral-600">Документы закупки-основания ({inherited.length}) — только просмотр</summary>
          <ul className="mt-1.5 list-none space-y-0.5 p-0">
            {inherited.map((d, i) => <li key={i}>{d.href ? <a href={d.href} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">{d.text}</a> : d.text}</li>)}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
