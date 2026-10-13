"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { useConfirm } from "@/components/confirm-dialog";
import { DRIVE_DOC_TYPES, DRIVE_DOC_TYPE_LABELS, type DriveDocTypeKey } from "@/lib/drive-docs";
import { TH_LEFT } from "@/components/tree-table";
import { analyzeBulkDocument, searchBulkTargets, uploadBulkDocument } from "./bulk-actions";
import type { BulkEntity, BulkTarget } from "@/lib/bulk-doc-match";

const ENTITY_LABEL: Record<BulkEntity, string> = { purchase: "Закупка", payment: "Оплата поставщику", productionPayment: "Оплата производства", order: "ТЗ", batch: "Партия", lot: "Лот" };
const ENTITIES = Object.keys(ENTITY_LABEL) as BulkEntity[];
const MAX_FILES = 40;

type Status = "analyzing" | "ready" | "uploading" | "done" | "failed";
type Row = {
  id: string;
  file: File;
  status: Status;
  include: boolean;
  docType: DriveDocTypeKey;
  number: string;
  date: string;
  target: BulkTarget | null;
  candidates: BulkTarget[];
  note: string | null;
  msg: string | null;
  picking: boolean;
};

const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);
const cell = "h-8 rounded border border-neutral-300 bg-white px-1.5 text-xs";

/** Массовая загрузка документов: выбрать/перетащить файлы → таблица «файл → привязка → тип → номер/дата» → «Загрузить и привязать». */
export function BulkUpload() {
  const router = useRouter();
  const { ask, node } = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const patch = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  async function add(files: FileList | File[]) {
    setSummary(null);
    const list = [...files].slice(0, MAX_FILES);
    const fresh: Row[] = list.map((file) => ({ id: crypto.randomUUID(), file, status: "analyzing", include: true, docType: "OTHER", number: "", date: "", target: null, candidates: [], note: null, msg: null, picking: false }));
    setRows((rs) => [...rs, ...fresh]);
    for (const r of fresh) {
      try {
        const fd = new FormData();
        fd.set("file", r.file);
        const a = await analyzeBulkDocument(fd);
        if ("error" in a) patch(r.id, { status: "failed", include: false, msg: a.error });
        else patch(r.id, { status: "ready", docType: a.docType, number: a.number, date: a.date, target: a.target, candidates: a.candidates, note: a.note, include: !!a.target && !a.duplicate });
      } catch {
        patch(r.id, { status: "failed", include: false, msg: "Не удалось разобрать файл: пропала связь с сервером" });
      }
    }
  }

  const todo = rows.filter((r) => r.include && r.status !== "done" && r.status !== "analyzing" && r.target);
  const waiting = rows.some((r) => r.status === "analyzing");

  async function submit() {
    if (todo.length === 0) return;
    const text = (
      <div className="flex flex-col gap-2">
        <p className="font-semibold">Загрузить и привязать файлов: {todo.length}</p>
        <ul className="max-h-60 list-disc space-y-0.5 overflow-auto pl-5 text-xs text-neutral-700">
          {todo.map((r) => <li key={r.id}>{r.file.name} → {ENTITY_LABEL[r.target!.entity]}: {r.target!.label} ({DRIVE_DOC_TYPE_LABELS[r.docType]}{r.number ? ` № ${r.number}` : ""})</li>)}
        </ul>
        <p className="text-xs text-neutral-500">Ошибка по одному файлу не остановит остальные. После привязки подтверждение связанных строк сбрасывается — проверьте их в «Подтвердить».</p>
      </div>
    );
    if (!(await ask(text, { ok: `Загрузить (${todo.length})`, wide: true }))) return;
    setBusy(true);
    setSummary(null);
    let ok = 0, bad = 0;
    for (const r of todo) {
      patch(r.id, { status: "uploading", msg: null });
      try {
        const fd = new FormData();
        fd.set("file", r.file);
        fd.set("entity", r.target!.entity);
        fd.set("entityId", r.target!.id);
        fd.set("docType", r.docType);
        fd.set("docNumber", r.number);
        fd.set("docDate", r.date);
        fd.set("title", r.file.name.replace(/\.[A-Za-z0-9]{1,8}$/, ""));
        const res = await uploadBulkDocument(fd);
        if (res.error) { bad++; patch(r.id, { status: "failed", msg: res.error }); }
        else { ok++; patch(r.id, { status: "done", include: false, msg: "Загружен и привязан" }); }
      } catch {
        bad++;
        patch(r.id, { status: "failed", msg: "Не удалось загрузить: пропала связь или сервер отклонил запрос" });
      }
    }
    setBusy(false);
    setSummary(`Загружено и привязано: ${ok}${bad ? `; ошибок: ${bad} (строки с ошибкой остались в таблице, их можно исправить и повторить)` : ""}.`);
    if (ok > 0) router.refresh();
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-3" aria-label="Массовая загрузка документов" data-bulk-upload>
      {node}
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) void add(e.dataTransfer.files); }}
        className={"flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm " + (drag ? "border-[var(--ui-accent)] bg-[var(--ui-soft)]" : "border-neutral-300")}
      >
        <p className="text-neutral-700">Перетащите сюда несколько файлов (PDF, Excel, Word, JPG, PNG; до 25 МБ каждый) или выберите их.</p>
        <input ref={inputRef} type="file" multiple accept=".pdf,.xlsx,.docx,.jpg,.jpeg,.png" className="hidden" onChange={(e) => { if (e.target.files?.length) void add(e.target.files); e.target.value = ""; }} />
        <Button type="button" variant="outline" className="btn-accent" onClick={() => inputRef.current?.click()} disabled={busy}>Выбрать файлы</Button>
        <p className="text-xs text-neutral-500">Привязка предлагается по номеру в имени файла и в тексте (№ счёта, УПД, п/п, ТЗ, партия, лот). Нет однозначного совпадения — выберите вручную.</p>
      </div>

      {rows.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-neutral-200">
                  <th className={TH_LEFT} />
                  <th className={TH_LEFT}>Файл</th>
                  <th className={TH_LEFT}>Предложенная привязка</th>
                  <th className={TH_LEFT}>Тип документа</th>
                  <th className={TH_LEFT}>Номер</th>
                  <th className={TH_LEFT}>Дата</th>
                  <th className={TH_LEFT}>Состояние</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-neutral-100 align-top">
                    <td className="px-2 py-2"><input type="checkbox" checked={r.include && !!r.target} disabled={!r.target || r.status === "done" || r.status === "analyzing" || busy} onChange={(e) => patch(r.id, { include: e.target.checked })} aria-label={`Загрузить: ${r.file.name}`} /></td>
                    <td className="px-2 py-2"><div className="max-w-[16rem] break-words">{r.file.name}</div><div className="text-xs text-neutral-500">{size(r.file.size)}</div></td>
                    <td className="px-2 py-2">
                      {r.status === "analyzing" ? <span className="text-xs text-neutral-500">Разбираем…</span> : (
                        <div className="flex max-w-[22rem] flex-col gap-1">
                          {r.target ? (
                            <div><span className="text-xs text-neutral-500">{ENTITY_LABEL[r.target.entity]}:</span> <b>{r.target.label}</b><div className="text-xs text-neutral-500">{r.target.why}</div></div>
                          ) : (
                            <span className="text-xs text-amber-800">{r.note ?? "Выберите привязку вручную"}</span>
                          )}
                          {r.status !== "done" && <Picker row={r} disabled={busy} onPick={(t) => patch(r.id, { target: t, include: true, picking: false })} />}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2"><Select className={cell} value={r.docType} disabled={busy || r.status === "done"} onChange={(e) => patch(r.id, { docType: e.target.value as DriveDocTypeKey })} aria-label="Тип документа">{DRIVE_DOC_TYPES.map((t) => <option key={t} value={t}>{DRIVE_DOC_TYPE_LABELS[t]}</option>)}</Select></td>
                    <td className="px-2 py-2"><Input className={cell + " w-28"} value={r.number} disabled={busy || r.status === "done"} onChange={(e) => patch(r.id, { number: e.target.value })} aria-label="Номер документа" /></td>
                    <td className="px-2 py-2"><Input type="date" className={cell} value={r.date} disabled={busy || r.status === "done"} onChange={(e) => patch(r.id, { date: e.target.value })} aria-label="Дата документа" /></td>
                    <td className="px-2 py-2 text-xs">
                      {r.status === "uploading" && <span className="text-neutral-500">Загружаем…</span>}
                      {r.status === "done" && <span className="text-emerald-700">{r.msg}</span>}
                      {r.status === "failed" && <span className="text-red-700" role="alert">{r.msg}</span>}
                      {r.status === "ready" && r.target && r.note && <span className="text-amber-800">{r.note}</span>}
                      {r.status === "ready" && !r.target && <span className="text-neutral-500">Не будет загружен, пока не выбрана привязка</span>}
                      {r.status !== "uploading" && r.status !== "done" && <button type="button" className="ml-1 text-neutral-500 underline" disabled={busy} onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}>убрать</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={submit} disabled={busy || waiting || todo.length === 0}>{busy ? "Загружаем…" : `Загрузить и привязать (${todo.length})`}</Button>
            <Button type="button" variant="ghost" onClick={() => { setRows((rs) => rs.filter((r) => r.status === "uploading")); setSummary(null); }} disabled={busy}>Очистить список</Button>
            {summary && <span className="text-sm text-neutral-700" role="status">{summary}</span>}
          </div>
        </>
      )}
    </section>
  );
}

function Picker({ row, disabled, onPick }: { row: Row; disabled: boolean; onPick: (t: BulkTarget) => void }) {
  const [open, setOpen] = useState(false);
  const [entity, setEntity] = useState<BulkEntity>(row.target?.entity ?? row.candidates[0]?.entity ?? "purchase");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<BulkTarget[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function search() {
    setErr(null);
    try {
      setFound(await searchBulkTargets(entity, q));
    } catch {
      setErr("Поиск не выполнен: нет связи с сервером");
    }
  }
  if (!open) {
    return (
      <div className="flex flex-col gap-1">
        {row.candidates.length > 1 && !row.target && (
          <Select className={cell} defaultValue="" disabled={disabled} onChange={(e) => { const t = row.candidates.find((c) => `${c.entity}:${c.id}` === e.target.value); if (t) onPick(t); }} aria-label="Подходящие объекты">
            <option value="">Подходящие: {row.candidates.length}…</option>
            {row.candidates.map((c) => <option key={`${c.entity}:${c.id}`} value={`${c.entity}:${c.id}`}>{ENTITY_LABEL[c.entity]}: {c.label}</option>)}
          </Select>
        )}
        <button type="button" disabled={disabled} className="w-fit text-xs text-neutral-600 underline" onClick={() => setOpen(true)}>{row.target ? "Изменить привязку" : "Выбрать вручную"}</button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded border border-neutral-200 p-2">
      <div className="flex gap-1">
        <Select className={cell} value={entity} onChange={(e) => { setEntity(e.target.value as BulkEntity); setFound(null); }} aria-label="К чему привязать">{ENTITIES.map((e) => <option key={e} value={e}>{ENTITY_LABEL[e]}</option>)}</Select>
        <Input className={cell + " min-w-0 flex-1"} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }} placeholder="номер, поставщик…" aria-label="Поиск объекта" />
        <Button type="button" size="sm" variant="outline" onClick={search}>Найти</Button>
      </div>
      {err && <span className="text-xs text-red-700">{err}</span>}
      {found && (found.length === 0 ? <span className="text-xs text-neutral-500">Ничего не найдено</span> : (
        <ul className="max-h-40 overflow-auto text-xs">
          {found.map((t) => <li key={t.id}><button type="button" className="w-full rounded px-1 py-0.5 text-left hover:bg-neutral-100" onClick={() => { onPick(t); setOpen(false); }}>{t.label}</button></li>)}
        </ul>
      ))}
      <button type="button" className="w-fit text-xs text-neutral-500 underline" onClick={() => setOpen(false)}>Свернуть</button>
    </div>
  );
}
