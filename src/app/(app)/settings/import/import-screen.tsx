"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/info-hint";
import { useConfirm } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";
import { applyImportAction, previewImport, rollbackImportAction } from "./actions";
import type { ImportPreview, HistoryItem } from "@/lib/import-server";
import type { Counts, ImportKind, PartPreview } from "@/lib/import-core";

const MAX_BYTES = 20 * 1024 * 1024;
const SHOWN = 30;

const CARDS: { kind: ImportKind; title: string; hint: string }[] = [
  { kind: "sales", title: "Поступления и продажи", hint: "Файл «поступления и продажи», листы «поступления» и «продажи». Строка определяется по виду, заказу, артикулу, цвету и дате: исправленная ячейка обновляет строку." },
  { kind: "prices", title: "Прайс розницы и размеры", hint: "Файл «отчет по товарам фото и цены»: лист Current Price даёт прайс, лист Report — размеры. Данные хранятся по датам, актуальной считается последняя загрузка." },
  { kind: "photos", title: "Фото артикулов", hint: "Лист «фото» со встроенными картинками. Только просмотр: спорные пары (одна картинка у нескольких строк) автоматически не пишутся." },
];
const KIND_TITLE: Record<ImportKind, string> = { sales: "Поступления и продажи", prices: "Прайс и размеры", photos: "Фото артикулов" };

const dash = (n: number) => (n ? n.toLocaleString("ru-RU") : "—");
const when = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

function sumCounts(c: Counts) {
  const parts = [c.added && `${c.added} нов.`, c.changed && `${c.changed} изм.`, c.removed && `${c.removed} удал.`].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

export function ImportScreen({ history }: { history: HistoryItem[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<ImportKind>("sales");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [removeMissing, setRemoveMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<null | "check" | "apply" | "rollback">(null);
  const [drag, setDrag] = useState(false);
  const [, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const { ask, node } = useConfirm();

  const reset = useCallback(() => { setFile(null); setPreview(null); setError(null); setRemoveMissing(false); if (input.current) input.current.value = ""; }, []);

  const form = (f: File, k: ImportKind, rm: boolean, sha?: string) => {
    const fd = new FormData();
    fd.set("kind", k); fd.set("file", f); fd.set("removeMissing", rm ? "1" : "0");
    if (sha) fd.set("sha", sha);
    return fd;
  };

  const check = useCallback(async (f: File, k: ImportKind, rm: boolean) => {
    setError(null); setPreview(null); setDone(null);
    if (!/\.xlsx$/i.test(f.name)) { setError("Нужен файл .xlsx"); return; }
    if (f.size > MAX_BYTES) { setError("Файл больше 20 МБ"); return; }
    setBusy("check");
    try {
      const r = await previewImport(form(f, k, rm));
      if (r.error) setError(r.error); else setPreview(r.preview ?? null);
    } catch {
      setError("Не удалось проверить файл. Попробуйте ещё раз.");
    }
    setBusy(null);
  }, []);

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    setFile(f); setRemoveMissing(false);
    void check(f, kind, false);
  };

  const choose = (k: ImportKind) => { if (busy) return; setKind(k); reset(); setDone(null); };

  const apply = async () => {
    if (!file || !preview) return;
    const removed = removeMissing ? preview.parts.reduce((s, p) => s + p.counts.removed, 0) : 0;
    const ok = await ask(
      <div className="flex flex-col gap-1">
        <b>Загрузить «{file.name}»?</b>
        <span className="text-sm text-neutral-600">Перед записью сохранится журнал, загрузку можно откатить.{removed ? ` Будет удалено строк: ${removed}.` : ""}</span>
      </div>,
      { ok: "Загрузить" },
    );
    if (!ok) return;
    setBusy("apply"); setError(null);
    try {
      const r = await applyImportAction(form(file, kind, removeMissing, preview.sha256));
      if (r.error) setError(r.error);
      else { setDone(r.result?.summary ?? []); reset(); startTransition(() => router.refresh()); }
    } catch {
      setError("Загрузка не выполнена, данные не изменены.");
    }
    setBusy(null);
  };

  const rollback = async (h: HistoryItem) => {
    const ok = await ask(
      <div className="flex flex-col gap-1">
        <b>Откатить загрузку от {when(h.at)}?</b>
        <span className="text-sm text-neutral-600">{KIND_TITLE[h.kind]}, «{h.fileName}». Данные вернутся к состоянию до неё.</span>
      </div>,
      { ok: "Откатить", danger: true },
    );
    if (!ok) return;
    setBusy("rollback"); setError(null); setDone(null);
    try {
      const r = await rollbackImportAction(h.id);
      if (r.error) setError(r.error); else { setDone(r.lines ?? []); startTransition(() => router.refresh()); }
    } catch {
      setError("Откат не выполнен.");
    }
    setBusy(null);
  };

  const last = (k: ImportKind) => history.find((h) => h.kind === k && h.status === "applied");
  const step = !file ? 1 : busy === "check" || !preview ? 2 : 3;
  const latestOverall = history.find((h) => h.canRollback);
  const canApply = !!preview?.canApply && !busy;
  const removedTotal = preview?.parts.reduce((s, p) => s + p.counts.removed, 0) ?? 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Три карточки */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3" role="radiogroup" aria-label="Что загружаем">
        {CARDS.map((c) => {
          const l = last(c.kind);
          const on = kind === c.kind;
          return (
            <div key={c.kind} className={cn("relative rounded-lg border bg-white p-4 transition-colors", on ? "border-neutral-900" : "border-neutral-200 hover:border-neutral-400")}>
              <button type="button" role="radio" aria-checked={on} onClick={() => choose(c.kind)} className="flex min-h-11 w-full flex-col items-start gap-1 pr-8 text-left">
                <span className="text-sm font-semibold">{c.title}</span>
                <span className="text-xs text-neutral-500">{c.kind === "photos" ? "Только просмотр" : l ? `Загружено ${when(l.at)}` : "Ещё не загружали"}</span>
              </button>
              <span className="absolute right-3 top-3"><InfoHint align="right">{c.hint}</InfoHint></span>
            </div>
          );
        })}
      </div>

      {/* Шаги */}
      <ol className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" aria-label="Шаги">
        {["Выбрать файл", "Проверить", kind === "photos" ? "Просмотр" : "Загрузить"].map((t, i) => (
          <li key={t} className={cn("flex items-center gap-2", step === i + 1 ? "font-semibold text-neutral-900" : step > i + 1 ? "text-neutral-500" : "text-neutral-400")}>
            <span className={cn("flex h-6 w-6 items-center justify-center rounded-full border text-xs", step === i + 1 ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300")}>{step > i + 1 ? "✓" : i + 1}</span>
            {t}
          </li>
        ))}
      </ol>

      {/* Выбор файла */}
      <div
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (!busy) pick(e.dataTransfer.files?.[0]); }}
        className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center", drag ? "border-neutral-900 bg-neutral-50" : "border-neutral-300")}
      >
        <input ref={input} type="file" accept=".xlsx" className="sr-only" aria-label="Файл .xlsx" onChange={(e) => pick(e.target.files?.[0])} />
        {file ? <p className="max-w-full break-all text-sm font-medium">{file.name}</p> : <p className="text-sm text-neutral-500">Перетащите файл .xlsx сюда</p>}
        <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => input.current?.click()}>{file ? "Другой файл" : "Выбрать файл"}</Button>
        {busy === "check" && <p className="text-xs text-neutral-500" role="status">Проверяем…</p>}
      </div>

      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {done && (
        <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <b>Готово.</b>
          <ul className="mt-1 list-disc pl-5">{done.map((s) => <li key={s}>{s}</li>)}</ul>
          <p className="mt-1 text-xs text-emerald-800">Обновятся: Cashflow, Продажи, Маржа, Дашборд, Артикулы.</p>
        </div>
      )}

      {preview && preview.parts.map((p) => <Part key={p.type} p={p} multi={preview.parts.length > 1} />)}

      {preview && kind !== "photos" && (
        <div className="flex flex-col items-start gap-3">
          {removedTotal > 0 && (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={removeMissing} disabled={!!busy} onChange={(e) => { setRemoveMissing(e.target.checked); if (file) void check(file, kind, e.target.checked); }} />
              удалить строки, которых нет в файле ({removedTotal})
            </label>
          )}
          {preview.nothing && !preview.blocked && <p className="text-sm text-neutral-500">Изменений нет — загружать нечего.</p>}
          {preview.blocked && <p className="text-sm text-red-800">Исправьте ошибки в файле — загрузка закрыта.</p>}
          <Button type="button" disabled={!canApply} onClick={apply}>{busy === "apply" ? "Загружаем…" : "Загрузить"}</Button>
        </div>
      )}

      {/* История */}
      <section className="flex flex-col gap-2" aria-labelledby="hist">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="hist" className="text-base font-semibold">История загрузок</h2>
          <Button type="button" variant="outline" size="sm" disabled={!latestOverall || !!busy} onClick={() => latestOverall && rollback(latestOverall)}>Откатить последнюю загрузку</Button>
        </div>
        {history.length === 0 ? <p className="text-sm text-neutral-500">Загрузок пока не было.</p> : (
          <div className="table-keep scroll-hint overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
                <tr><th className="px-3 py-2 font-medium">Дата</th><th className="px-3 py-2 font-medium">Что</th><th className="px-3 py-2 font-medium">Файл</th><th className="px-3 py-2 font-medium">Кто</th><th className="px-3 py-2 font-medium">Итог</th><th className="px-3 py-2 font-medium">Статус</th><th className="px-3 py-2" /></tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {history.map((h) => (
                  <tr key={h.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2">{when(h.at)}</td>
                    <td className="px-3 py-2">{KIND_TITLE[h.kind]}</td>
                    <td className="max-w-[16rem] break-all px-3 py-2">{h.fileName}</td>
                    <td className="px-3 py-2">{h.byName ?? "—"}</td>
                    <td className="px-3 py-2 text-neutral-600">{h.parts.map((p) => sumCounts(p.counts)).join(" | ")}</td>
                    <td className="whitespace-nowrap px-3 py-2">{h.status === "applied" ? "применена" : `откачена${h.rolledBackAt ? " " + when(h.rolledBackAt) : ""}`}</td>
                    <td className="px-3 py-2 text-right">{h.canRollback && <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={() => rollback(h)}>Откатить</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {node}
    </div>
  );
}

function Part({ p, multi }: { p: PartPreview; multi: boolean }) {
  const [all, setAll] = useState(false);
  const c = p.counts;
  const cells: [string, number, string][] = [
    ["Новые", c.added, ""], ["Изменённые", c.changed, ""], ["Без изменений", c.same, ""], ["Удалённые из файла", c.removed, ""], ["Ошибки", c.errors, c.errors ? "text-red-700" : ""],
  ];
  const rows = all ? p.diffs : p.diffs.slice(0, SHOWN);
  return (
    <section className="flex flex-col gap-3" aria-label={p.title}>
      {multi && <h2 className="text-base font-semibold">{p.title}</h2>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {cells.map(([t, n, cls]) => (
          <div key={t} className="rounded-lg border border-neutral-200 bg-white px-3 py-2">
            <div className="text-xs text-neutral-500">{t}</div>
            <div className={cn("text-lg font-semibold tabular-nums", n ? cls : "text-neutral-300")}>{dash(n)}</div>
          </div>
        ))}
      </div>

      {p.errors.length > 0 && (
        <ul role="alert" className="list-disc rounded-md border border-red-200 bg-red-50 py-2 pl-7 pr-3 text-sm text-red-800">
          {p.errors.slice(0, 10).map((e) => <li key={e}>{e}</li>)}
          {p.errors.length > 10 && <li>и ещё {p.errors.length - 10}</li>}
        </ul>
      )}

      {p.totals.length > 0 && (
        <div className="table-keep scroll-hint overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs text-neutral-500">
              <tr><th className="px-3 py-2 text-left font-medium">Итоги</th><th className="px-3 py-2 text-right font-medium">В файле</th><th className="px-3 py-2 text-right font-medium">В базе</th></tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {p.totals.map((t) => (
                <tr key={t.label}>
                  <td className="px-3 py-2">{t.label}{t.unit ? <span className="text-neutral-400">, {t.unit}</span> : null}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{t.file}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-600">{t.db}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {p.diffTotal > 0 && (
        <div className="flex flex-col gap-2">
          <div className="table-keep scroll-hint overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
                <tr><th className="px-3 py-2 font-medium">Ключ</th><th className="px-3 py-2 font-medium">Поле</th><th className="px-3 py-2 text-right font-medium">Было</th><th className="px-3 py-2 text-right font-medium">Стало</th></tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rows.map((d, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">{d.key}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-600">{d.field}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-neutral-500">{d.before}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-medium">{d.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {p.diffTotal > SHOWN && (
            <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setAll((v) => !v)}>{all ? "Свернуть" : `Показать все (${p.diffTotal})`}</Button>
          )}
        </div>
      )}

      {p.warnings.length > 0 && (
        <details className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <summary className="min-h-6 cursor-pointer font-medium">Предупреждения ({p.warnings.length})</summary>
          <ul className="mt-2 list-disc pl-5">{p.warnings.slice(0, 30).map((w) => <li key={w}>{w}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
