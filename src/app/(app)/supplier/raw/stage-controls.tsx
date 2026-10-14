"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { RAW_STAGES, RAW_STAGE_KEYS, STAGE_STATUS_LABEL } from "@/lib/raw-stage";
import { copyChain, deleteStage, finishStage, nextStage, saveStage, startStage, type StageState } from "./stage-actions";

export type StageEdit = {
  id: string; stage: string; status: string; place: string; lotNumber: string;
  plannedStart: string; plannedEnd: string; factStart: string; factEnd: string; qty: string; note: string;
};

const PLACES = ["Прогресс", "МК ЛИС", "XIN", "ЛИС", "Финляндия", "Калининград", "Москва"];
const input = "h-9 rounded-md border border-neutral-300 px-2";

/** Форма этапа: «+ Этап» (id пусто) или правка существующего. */
export function StageForm({ purchaseId, lots, initial, onDone }: { purchaseId: string; lots: string[]; initial?: StageEdit; onDone?: () => void }) {
  const [state, action, pending] = useActionState<StageState, FormData>(saveStage, {});
  useEffect(() => { if (state.ok) onDone?.(); }, [state, onDone]);
  const v = initial;
  return (
    <form action={action} className="flex flex-col gap-2 rounded-md border border-neutral-300 bg-neutral-50 p-3 text-sm">
      {v ? <input type="hidden" name="id" value={v.id} /> : <input type="hidden" name="purchaseId" value={purchaseId} />}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <label className="flex flex-col gap-1 sm:col-span-2">Этап
          <select name="stage" defaultValue={v?.stage ?? "DRESSING"} className={input}>
            {RAW_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">Где (завод, склад, город)
          <input name="place" list="raw-places" defaultValue={v?.place ?? ""} maxLength={80} className={input} />
          <datalist id="raw-places">{PLACES.map((p) => <option key={p} value={p} />)}</datalist>
        </label>
        <label className="flex flex-col gap-1">Статус
          <select name="status" defaultValue={v?.status ?? "PLANNED"} className={input}>
            {Object.entries(STAGE_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">План: с<input name="plannedStart" type="date" defaultValue={v?.plannedStart} className={input} /></label>
        <label className="flex flex-col gap-1">План: по (ждём к)<input name="plannedEnd" type="date" defaultValue={v?.plannedEnd} className={input} /></label>
        <label className="flex flex-col gap-1">Факт: с<input name="factStart" type="date" defaultValue={v?.factStart} className={input} /></label>
        <label className="flex flex-col gap-1">Факт: по<input name="factEnd" type="date" defaultValue={v?.factEnd} className={input} /></label>
        <label className="flex flex-col gap-1">Шкур на этапе<input name="qty" type="number" min={0} step={1} defaultValue={v?.qty} className={input} /></label>
        <label className="flex flex-col gap-1 sm:col-span-3">Примечание<input name="note" defaultValue={v?.note} maxLength={500} className={input} /></label>
      </div>
      {!v && lots.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-neutral-600">Только для отдельных лотов (по умолчанию — на весь аукцион)</summary>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {lots.map((l) => <label key={l} className="flex items-center gap-1"><input type="checkbox" name="lots" value={l} />лот {l}</label>)}
          </div>
        </details>
      )}
      {state.error && <p role="alert" className="text-red-700">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>{pending ? "Сохраняю…" : "Сохранить"}</Button>
        {onDone && <Button type="button" size="sm" variant="outline" onClick={onDone}>Отмена</Button>}
      </div>
    </form>
  );
}

/** Кнопка «+ Этап» с раскрывающейся формой. */
export function AddStage({ purchaseId, lots }: { purchaseId: string; lots: string[] }) {
  const [open, setOpen] = useState(false);
  if (!open) return <Button type="button" size="sm" onClick={() => setOpen(true)}>+ Этап</Button>;
  return <div className="w-full"><StageForm purchaseId={purchaseId} lots={lots} onDone={() => setOpen(false)} /></div>;
}

/** «Скопировать цепочку этапов из прошлого аукциона» — в пустую ленту. */
export function CopyChain({ purchaseId }: { purchaseId: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => start(async () => setErr((await copyChain(purchaseId)).error ?? null))}>Скопировать цепочку из прошлого аукциона</Button>
      {err && <span className="text-sm text-red-700">{err}</span>}
    </span>
  );
}

/** Быстрые кнопки одного этапа: начать, завершить, следующий, изменить, удалить. */
export function StageControls({ purchaseId, lots, s }: { purchaseId: string; lots: string[]; s: StageEdit }) {
  const [edit, setEdit] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const run = (f: (id: string) => Promise<{ error?: string }>) => start(async () => setErr((await f(s.id)).error ?? null));
  const hasNext = RAW_STAGE_KEYS.indexOf(s.stage) < RAW_STAGE_KEYS.length - 1;
  if (edit) return <div className="mt-2 w-full"><StageForm purchaseId={purchaseId} lots={lots} initial={s} onDone={() => setEdit(false)} /></div>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {s.status === "PLANNED" && <Button type="button" size="sm" disabled={pending} onClick={() => run(startStage)}>Начать этап</Button>}
      {s.status !== "DONE" && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(finishStage)}>Завершить</Button>}
      {s.status === "IN_PROGRESS" && hasNext && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(nextStage)}>→ следующий этап</Button>}
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setEdit(true)}>Изменить</Button>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { if (confirm("Удалить этап?")) run(deleteStage); }}>Удалить</Button>
      {err && <span className="text-sm text-red-700">{err}</span>}
    </div>
  );
}
