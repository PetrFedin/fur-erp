"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SUP_STAGES, nextSupStage, supStage, type SupEntry } from "@/lib/supplier-calendar";
import { advanceEntry, confirmImport, deleteEntry, previewImport, saveEntry, type CalState, type PreviewState } from "./actions";

const INPUT = "h-9 rounded-md border border-neutral-300 px-2 text-sm";

/** Форма записи: «артикул · цвет · размер · количество · этап · плановая и фактическая дата · комментарий». */
export function EntryForm({ models, initial, onDone }: { models: string[]; initial?: SupEntry; onDone?: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<CalState, FormData>(async (p, fd) => {
    const r = await saveEntry(p, fd);
    if (r.ok) { if (!initial) ref.current?.reset(); router.refresh(); onDone?.(); }
    return r;
  }, {});
  return (
    <form ref={ref} action={action} className="grid grid-cols-1 gap-3 rounded-md border border-neutral-300 bg-white p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <label className="flex flex-col gap-1">Артикул
        <input name="articleCode" list="sup-models" required defaultValue={initial?.articleCode} placeholder="Начните вводить" className={INPUT} autoComplete="off" />
      </label>
      <label className="flex flex-col gap-1">Цвет / мех
        <input name="color" maxLength={100} defaultValue={initial?.color} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1">Размер
        <input name="size" maxLength={20} defaultValue={initial?.size} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1">Количество
        <input name="quantity" type="number" min={1} step={1} required defaultValue={initial?.quantity ?? 1} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1">Этап
        <select name="status" defaultValue={initial?.status ?? "launch"} className={INPUT}>
          {SUP_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">Плановая дата
        <input name="planDate" type="date" required defaultValue={initial?.planDate} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1">Фактическая дата
        <input name="factDate" type="date" defaultValue={initial?.factDate} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1">№ ТЗ или отгрузки (по желанию)
        <input name="docNote" maxLength={60} defaultValue={initial?.docNote} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">Комментарий
        <input name="notes" maxLength={1000} defaultValue={initial?.notes} className={INPUT} />
      </label>
      <datalist id="sup-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
        <Button type="submit" size="sm" disabled={pending}>{pending ? "Сохраняю…" : initial ? "Сохранить" : "Добавить запись"}</Button>
        {state.error && <span role="alert" className="text-red-700">{state.error}</span>}
        {state.ok && !initial && <span role="status" className="text-green-800">Запись добавлена, она уже видна у нас</span>}
      </div>
    </form>
  );
}

/** Кнопки строки: «→ следующий этап», «Изменить», «Удалить». */
export function RowActions({ entry, models }: { entry: SupEntry; models: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState(false);
  const [err, setErr] = useState("");
  const next = nextSupStage(entry.status);
  const run = (f: () => Promise<CalState>) => start(async () => { setErr(""); const r = await f(); if (r.error) setErr(r.error); else router.refresh(); });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {next && <Button type="button" size="sm" disabled={pending} onClick={() => run(() => advanceEntry(entry.id))}>→ {next.label}</Button>}
        <Button type="button" size="sm" variant="outline" onClick={() => setEdit((x) => !x)}>{edit ? "Закрыть" : "Изменить"}</Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { if (window.confirm(`Удалить запись ${entry.articleCode}?`)) run(() => deleteEntry(entry.id)); }}>Удалить</Button>
      </div>
      {err && <span role="alert" className="text-xs text-red-700">{err}</span>}
      {edit && <EntryForm models={models} initial={entry} onDone={() => { setEdit(false); router.refresh(); }} />}
    </div>
  );
}

export function StageBadge({ status }: { status: string }) {
  const st = supStage(status);
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${st.chip}`}>{st.label}</span>;
}

/** Загрузка Excel «Таблица по запуску изделий»: предпросмотр и подтверждение. */
export function ImportBox() {
  const router = useRouter();
  const [state, action, pending] = useActionState<PreviewState, FormData>(previewImport, {});
  const [res, setRes] = useState<PreviewState | null>(null);
  const [busy, start] = useTransition();
  const ok = (state.rows ?? []).filter((r) => !r.problem);
  const confirm = () => start(async () => { const r = await confirmImport(JSON.stringify(ok)); setRes(r); if (r.done) router.refresh(); });
  return (
    <details className="rounded-md border border-neutral-300 p-3 text-sm">
      <summary className="cursor-pointer font-medium max-md:py-3">Загрузить из Excel</summary>
      <p className="mt-2 text-neutral-600">Таблица по запуску изделий: колонки «модель», «мех, цвет», «размер», «запуск», «шубы сданы», «сдача …», «принято …», «примечание», «дополнение». Одна строка таблицы — одно изделие. Сначала покажем, что получится, и только после подтверждения запишем.</p>
      <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
        <input name="file" type="file" accept=".xlsx" required />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>{pending ? "Читаю…" : "Показать, что получится"}</Button>
      </form>
      {state.error && <p role="alert" className="mt-2 text-red-700">{state.error}</p>}
      {state.rows && (
        <div className="mt-3 flex flex-col gap-2">
          <p>Строк: {state.rows.length}, годных: <b>{ok.length}</b>{state.skipped ? `, без даты или этапа пропущено: ${state.skipped}` : ""}.</p>
          <div className="max-h-72 overflow-auto rounded border border-neutral-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-neutral-100"><tr><th className="p-1 text-left">Артикул</th><th className="p-1 text-left">Цвет</th><th className="p-1 text-left">Размер</th><th className="p-1 text-left">Этап</th><th className="p-1 text-left">План</th><th className="p-1 text-left">Факт</th><th className="p-1 text-left">Замечание</th></tr></thead>
              <tbody>
                {state.rows.map((r) => (
                  <tr key={r.line} className={r.problem ? "bg-red-50" : ""}>
                    <td className="p-1">{r.articleCode}</td><td className="p-1">{r.color}</td><td className="p-1">{r.size}</td><td className="p-1">{supStage(r.status).label}</td><td className="p-1">{r.planDate}</td><td className="p-1">{r.factDate}</td><td className="p-1 text-red-700">{r.problem}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!res?.done && <div><Button type="button" size="sm" disabled={busy || ok.length === 0} onClick={confirm}>{busy ? "Записываю…" : `Записать ${ok.length}`}</Button></div>}
          {res?.done && <p role="status" className="text-green-800">{res.done}</p>}
          {res?.error && <p role="alert" className="text-red-700">{res.error}</p>}
        </div>
      )}
    </details>
  );
}
