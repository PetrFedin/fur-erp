"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { CreateDialog, DialogButtons, useCreateForm } from "@/components/create-dialog";
import { EditDialog, Field } from "@/components/edit-dialog";
import { DeleteEntityButton } from "@/components/delete-entity-button";
import { useUnsavedGuard } from "@/lib/use-unsaved-guard";
import { todayIso } from "@/lib/shipments";
import { createEvent, deleteEvent, markEventDone, updateEvent } from "../actions";

export type LineBrief = { id: string; label: string; quantity: number };
type LineVals = { qty: string; accepted: string; rejected: string; returned: string; comment: string };
export type EventValues = {
  id: string;
  title: string;
  date: string;
  time: string;
  /** "" — не указан, id пользователя, либо "__other" (внешний). */
  responsible: string;
  responsibleName: string;
  place: string;
  details: string;
  docLinks: string;
  expected: boolean;
  mode: "all" | "lines";
  lines: Record<string, LineVals>;
  /** Меняется при любой правке записи: окно правки пересоздаётся с новыми значениями. */
  version: string;
};

const EMPTY: LineVals = { qty: "", accepted: "", rejected: "", returned: "", comment: "" };
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/\s/g, "")));

/** Поля этапа: общие для «+ Этап» и «Изменить этап». Названия подсказываются из ранее использованных (datalist), готового списка нет. */
function EventFields({ lines, users, titles, initial, withNext }: { lines: LineBrief[]; users: { id: string; name: string }[]; titles: string[]; initial?: EventValues; withNext?: boolean }) {
  const listId = useId();
  const [today] = useState(() => todayIso());
  const [resp, setResp] = useState(initial?.responsible ?? "");
  const [mode, setMode] = useState<"all" | "lines">(initial?.mode ?? "all");
  const [vals, setVals] = useState<Record<string, LineVals>>(() => Object.fromEntries(lines.map((l) => [l.id, initial?.lines[l.id] ?? EMPTY])));
  const setVal = (id: string, k: keyof LineVals, v: string) => setVals((p) => ({ ...p, [id]: { ...(p[id] ?? EMPTY), [k]: v } }));

  return (
    <>
      <Field label="Название этапа" wide>
        <Input name="title" required maxLength={120} list={listId} defaultValue={initial?.title ?? ""} placeholder="например: Принято в Коптево" autoComplete="off" />
        <datalist id={listId}>
          {titles.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </Field>
      <Field label="Дата">
        <Input name="date" type="date" required defaultValue={initial?.date ?? today} />
      </Field>
      <Field label="Время" hint="Не знаете час — оставьте пустым">
        <Input name="time" type="time" defaultValue={initial?.time ?? ""} />
      </Field>
      <Field label="Ответственный">
        <Select name="responsible" value={resp} onChange={(e) => setResp(e.target.value)}>
          <option value="">— не указан —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
          <option value="__other">Другой (внешний)…</option>
        </Select>
      </Field>
      {resp === "__other" && (
        <Field label="Кто (внешний)">
          <Input name="responsibleName" maxLength={120} defaultValue={initial?.responsibleName ?? ""} placeholder="например: Василий (Веллмех)" />
        </Field>
      )}
      <Field label="Место" wide={resp === "__other"}>
        <Input name="place" maxLength={120} defaultValue={initial?.place ?? ""} />
      </Field>
      <Field label="Детализация" wide>
        <Textarea name="details" rows={3} maxLength={4000} defaultValue={initial?.details ?? ""} />
      </Field>
      <Field label="Документы: ссылки или названия (по одному в строке)" wide>
        <Textarea name="docLinks" rows={2} maxLength={2000} defaultValue={initial?.docLinks ?? ""} placeholder="https://… — ссылка станет кликабельной" />
      </Field>

      <details className="rounded-md border border-neutral-200 bg-neutral-50/50 px-3 py-2 sm:col-span-2" open={initial?.mode === "lines"}>
        <summary className="cursor-pointer select-none text-sm font-medium text-neutral-700">По позициям</summary>
        <div className="mt-2 flex flex-col gap-2 text-sm">
          <input type="hidden" name="mode" value={mode} />
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-1.5"><input type="radio" checked={mode === "all"} onChange={() => setMode("all")} /> Весь состав</label>
            <label className="flex items-center gap-1.5"><input type="radio" checked={mode === "lines"} onChange={() => setMode("lines")} /> Отметить по строкам</label>
          </div>
          {mode === "lines" && (
            <>
              <div>
                <Button type="button" variant="outline" size="sm" onClick={() => setVals(Object.fromEntries(lines.map((l) => [l.id, { ...(vals[l.id] ?? EMPTY), accepted: String(l.quantity), rejected: "", returned: "" }])))}>
                  Принято всё по строкам
                </Button>
              </div>
              <div className="max-h-[40vh] overflow-auto rounded-md border border-neutral-200 bg-white">
                <table className="w-full min-w-[640px] text-xs">
                  <thead className="sticky top-0 bg-neutral-50 text-left text-neutral-500">
                    <tr>
                      <th className="px-2 py-1.5">Строка</th>
                      <th className="px-2 py-1.5 text-right">По сколько шт.</th>
                      <th className="px-2 py-1.5 text-right">Принято</th>
                      <th className="px-2 py-1.5 text-right">Не принято</th>
                      <th className="px-2 py-1.5 text-right">Возвращено</th>
                      <th className="px-2 py-1.5">Комментарий-причина</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {lines.map((l) => {
                      const v = vals[l.id] ?? EMPTY;
                      const base = num(v.qty) ?? l.quantity;
                      const warn = (num(v.accepted) ?? 0) + (num(v.rejected) ?? 0) > base;
                      const cell = "h-8 w-16 text-right tabular-nums";
                      return (
                        <tr key={l.id}>
                          <td className="px-2 py-1.5">
                            {l.label} <span className="text-neutral-500">· {l.quantity} шт.</span>
                            {warn && <span className="block text-amber-700">принято + не принято больше {base} шт.</span>}
                          </td>
                          <td className="px-2 py-1.5 text-right"><Input className={cell} inputMode="numeric" name={`l_${l.id}_qty`} value={v.qty} onChange={(e) => setVal(l.id, "qty", e.target.value)} /></td>
                          <td className="px-2 py-1.5 text-right"><Input className={cell} inputMode="numeric" name={`l_${l.id}_accepted`} value={v.accepted} onChange={(e) => setVal(l.id, "accepted", e.target.value)} /></td>
                          <td className="px-2 py-1.5 text-right"><Input className={cell} inputMode="numeric" name={`l_${l.id}_rejected`} value={v.rejected} onChange={(e) => setVal(l.id, "rejected", e.target.value)} /></td>
                          <td className="px-2 py-1.5 text-right"><Input className={cell} inputMode="numeric" name={`l_${l.id}_returned`} value={v.returned} onChange={(e) => setVal(l.id, "returned", e.target.value)} /></td>
                          <td className="px-2 py-1.5"><Input className="h-8 min-w-40" maxLength={500} name={`l_${l.id}_comment`} value={v.comment} onChange={(e) => setVal(l.id, "comment", e.target.value)} /></td>
                        </tr>
                      );
                    })}
                    {lines.length === 0 && <tr><td colSpan={6} className="px-2 py-4 text-center text-neutral-500">Сначала добавьте состав отгрузки</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </details>

      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="expected" defaultChecked={initial?.expected ?? false} />
        Ожидаемый этап (запланирован, ещё не произошёл)
      </label>

      {withNext && (
        <fieldset className="grid grid-cols-1 gap-3 rounded-md border border-dashed border-neutral-300 p-3 sm:col-span-2 sm:grid-cols-3">
          <legend className="px-1 text-xs text-neutral-500">Следующий этап (необязательно): создаст ожидаемый этап</legend>
          <Field label="Название"><Input name="nextTitle" maxLength={120} list={listId} autoComplete="off" /></Field>
          <Field label="Ожидаемая дата"><Input name="nextDate" type="date" /></Field>
          <Field label="Время (необязательно)"><Input name="nextTime" type="time" /></Field>
        </fieldset>
      )}
    </>
  );
}

/** «+ Этап». */
export function NewEventButton({ shipmentId, lines, users, titles }: { shipmentId: string; lines: LineBrief[]; users: { id: string; name: string }[]; titles: string[] }) {
  return (
    <CreateDialog label="+ Этап" title="Новый этап" wide hint="Название — любое, подсказки берутся из ранее использованных. Этапы можно править и удалять.">
      <NewEventForm shipmentId={shipmentId} lines={lines} users={users} titles={titles} />
    </CreateDialog>
  );
}

function NewEventForm({ shipmentId, lines, users, titles }: { shipmentId: string; lines: LineBrief[]; users: { id: string; name: string }[]; titles: string[] }) {
  const { state, pending, dlg, setForm, onSubmit } = useCreateForm(createEvent.bind(null, shipmentId), {});
  const [dirty, setDirty] = useState(false);
  const guard = useUnsavedGuard(dirty && !state.ok, { links: false });
  return (
    <form
      ref={setForm}
      onSubmit={onSubmit}
      onChange={() => setDirty(true)}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      <EventFields lines={lines} users={users} titles={titles} withNext />
      {state.error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{state.error}</p>}
      <DialogButtons pending={pending} saveLabel="Добавить этап" onCancel={dlg?.close} />
      {guard}
    </form>
  );
}

/** Кнопки этапа: «Отметить выполненным» (для ожидаемого → сразу окно правки), «Изменить этап», «Удалить». */
export function EventActions({ v, lines, users, titles }: { v: EventValues; lines: LineBrief[]; users: { id: string; name: string }[]; titles: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [wantEdit, setWantEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // После «Отметить выполненным» ждём обновлённые данные (дата и время «сейчас»), и только потом открываем правку.
  if (wantEdit && !v.expected) {
    setWantEdit(false);
    setOpen(true);
  }

  return (
    <div className="flex flex-wrap items-start gap-1">
      {v.expected && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await markEventDone(v.id);
              if (r.error) return setError(r.error);
              setWantEdit(true);
              router.refresh();
            })
          }
        >
          {pending ? "Отмечаем…" : "Отметить выполненным"}
        </Button>
      )}
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>Изменить</Button>
      <EditDialog
        key={v.version}
        open={open}
        onOpenChange={setOpen}
        title="Изменить этап"
        hint="Правка попадает в журнал изменений."
        action={updateEvent.bind(null, v.id)}
        wide
      >
        <EventFields lines={lines} users={users} titles={titles} initial={v} />
      </EditDialog>
      <DeleteEntityButton variant="ghost" confirmText={`Удалить этап «${v.title}»? Отметки приёмки по нему тоже исчезнут.`} action={deleteEvent.bind(null, v.id)} />
      {error && <span role="alert" className="w-full text-xs text-red-600">{error}</span>}
    </div>
  );
}
