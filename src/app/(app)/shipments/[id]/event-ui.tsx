"use client";

import { useId, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { CreateDialog, DialogButtons, useCreateForm } from "@/components/create-dialog";
import { EditDialog, Field } from "@/components/edit-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { clientFileError } from "@/components/drive-documents";
import { useUnsavedGuard } from "@/lib/use-unsaved-guard";
import { todayIso } from "@/lib/shipments";
import { SIDES, type PeopleBySide, wallDateIso, wallNow, wallTimeHm } from "@/lib/shipment-calc";
import { acceptAllLines, cancelAcceptance, confirmAcceptance, createAcceptanceEvent, createEvent, deleteEvent, markEventDone, removeEventDocument, updateEvent, uploadEventDocument } from "../actions";
import { IconPencil, IconTrash } from "@/components/icons";

export type EventValues = {
  id: string;
  title: string;
  date: string;
  time: string;
  /** "WELLMEKH" | "CUM" ("" только у старых записей до прогона скрипта данных). */
  side: string;
  /** Ответственный текстом. */
  responsible: string;
  place: string;
  details: string;
  docLinks: string;
  expected: boolean;
  /** Меняется при любой правке записи: окно правки пересоздаётся с новыми значениями. */
  version: string;
};

type Common = { titles: string[]; people: PeopleBySide };

const FILE_ACCEPT = ".pdf,.xlsx,.docx,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

/** Поле «файл»: проверка типа и размера сразу при выборе (тот же порядок, что у документов закупок). */
function FileField({ label = "Документ: файл" }: { label?: string }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <Field label={label} wide hint="PDF, Excel, Word, JPEG или PNG до 25 МБ. Ещё файлы — кнопкой «+ Документ» на этапе.">
      <input
        type="file"
        name="file"
        accept={FILE_ACCEPT}
        className="text-sm file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1.5 file:text-xs"
        onChange={(e) => {
          const f = e.target.files?.[0];
          const bad = f ? clientFileError(f) : null;
          if (bad) e.target.value = "";
          setErr(bad);
        }}
      />
      {err && <span role="alert" className="text-xs text-red-600">{err}</span>}
    </Field>
  );
}

const OTHER = "__other__";

/**
 * «Кто»: выпадающий список действующих лиц выбранной компании + «Другой… (вписать)» с текстовым полем.
 * Форме уходит одно поле `name` (текст имени); список пересобирается при смене компании.
 */
function PersonPicker({ name, label, side, people, initial }: { name: string; label: string; side: string; people: PeopleBySide; initial?: string }) {
  const list = people[side] ?? [];
  const [choice, setChoice] = useState<string>(() => {
    const v = (initial ?? "").trim();
    if (!v) return "";
    const hit = (people[side] ?? []).find((x) => x.toLowerCase() === v.toLowerCase());
    return hit ?? OTHER;
  });
  const [custom, setCustom] = useState<string>(() => {
    const v = (initial ?? "").trim();
    return v && !(people[side] ?? []).some((x) => x.toLowerCase() === v.toLowerCase()) ? v : "";
  });
  // Смена компании: выбранный из списка человек, которого нет у новой компании, остаётся вписанным вручную.
  const [prevSide, setPrevSide] = useState(side);
  if (prevSide !== side) {
    setPrevSide(side);
    if (choice && choice !== OTHER && !list.some((x) => x === choice)) {
      setCustom(choice);
      setChoice(OTHER);
    }
  }
  const value = choice === OTHER ? custom.trim() : choice;
  return (
    <div className="flex flex-col gap-1 text-xs text-neutral-500" data-person-picker>
      <label className="flex flex-col gap-1">
        {label}
        <Select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label={label}>
          <option value="">Не указан</option>
          {list.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
          <option value={OTHER}>Другой… (вписать)</option>
        </Select>
      </label>
      {choice === OTHER && (
        <Input value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={120} placeholder="имя, например: Василий" autoComplete="off" aria-label={`${label}: имя`} autoFocus />
      )}
      <input type="hidden" name={name} value={value} />
    </div>
  );
}

/** Поля этапа: общие для «+ Этап» и «Изменить этап». Название подсказывается из ранее использованных (datalist); «Кто» — список действующих лиц компании. */
function EventFields({ titles, people, initial, withNext }: Common & { initial?: EventValues; withNext?: boolean }) {
  const listId = useId();
  const [today] = useState(() => todayIso());
  const [side, setSide] = useState(initial?.side || "WELLMEKH");
  // «Следующий этап»: пока не выбрано своё значение, «чьё действие» берётся как у основного этапа.
  const [nextSide, setNextSide] = useState<string | null>(null);
  return (
    <>
      <Field label="Чьё действие">
        <Select name="side" required value={side} onChange={(e) => setSide(e.target.value)}>
          {SIDES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </Select>
      </Field>
      <PersonPicker name="responsible" label="Кто" side={side} people={people} initial={initial?.responsible} />
      <Field label="Название этапа" wide>
        <Input name="title" required maxLength={120} list={listId} defaultValue={initial?.title ?? ""} placeholder="например: Приёмка в Коптево" autoComplete="off" />
        <datalist id={listId}>
          {titles.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </Field>
      <Field label="Дата" hint="Когда было или на когда запланировано (письмо получено/отправлено, встреча…)">
        <Input name="date" type="date" required defaultValue={initial?.date ?? today} />
      </Field>
      <Field label="Время" hint="Можно уточнить час: во сколько получено, отправлено, назначено. Не знаете — оставьте пустым">
        <Input name="time" type="time" defaultValue={initial?.time ?? ""} />
      </Field>
      <Field label="Место" wide>
        <Input name="place" maxLength={120} defaultValue={initial?.place ?? ""} />
      </Field>
      <Field label="Детализация" wide>
        <Textarea name="details" rows={3} maxLength={4000} defaultValue={initial?.details ?? ""} />
      </Field>
      <FileField />
      <Field label="Документы: ссылки или названия (по одному в строке)" wide>
        <Textarea name="docLinks" rows={2} maxLength={2000} defaultValue={initial?.docLinks ?? ""} placeholder="https://… — ссылка станет кликабельной" />
      </Field>

      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="expected" defaultChecked={initial?.expected ?? false} />
        Ожидаемый этап (запланирован, ещё не произошёл)
      </label>

      {withNext && (
        <fieldset className="grid grid-cols-1 gap-3 rounded-md border border-dashed border-neutral-300 p-3 sm:col-span-2 sm:grid-cols-2">
          <legend className="px-1 text-xs text-neutral-500">Следующий этап (необязательно): создаст ожидаемый этап</legend>
          <Field label="Название"><Input name="nextTitle" maxLength={120} list={listId} autoComplete="off" /></Field>
          <Field label="Ожидаемая дата"><Input name="nextDate" type="date" /></Field>
          <Field label="Время (необязательно)"><Input name="nextTime" type="time" /></Field>
          <Field label="Чьё действие">
            <Select name="nextSide" required value={nextSide ?? side} onChange={(e) => setNextSide(e.target.value)}>
              {SIDES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
          </Field>
          <PersonPicker name="nextResponsible" label="Кто" side={nextSide ?? side} people={people} />
        </fieldset>
      )}
    </>
  );
}

/** «+ Этап». */
export function NewEventButton({ shipmentId, titles, people, between }: { shipmentId: string; between?: { date: string; label: string } } & Common) {
  return (
    <CreateDialog label={between?.label ?? "+ Этап"} size={between ? "sm" : undefined} variant={between ? "ghost" : undefined} title="Новый этап" wide hint="Название — любое, подсказки берутся из ранее использованных. Файл документа загружается сразу при добавлении.">
      <NewEventForm shipmentId={shipmentId} titles={titles} people={people} date={between?.date} />
    </CreateDialog>
  );
}

function NewEventForm({ shipmentId, titles, people, date }: { shipmentId: string; date?: string } & Common) {
  const { state, pending, dlg, setForm, onSubmit } = useCreateForm(createEvent.bind(null, shipmentId), {});
  const [dirty, setDirty] = useState(false);
  const guard = useUnsavedGuard(dirty && !state.ok, { links: false });
  return (
    <form ref={setForm} onSubmit={onSubmit} onChange={() => setDirty(true)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <EventFields titles={titles} people={people} withNext initial={date ? ({ date } as EventValues) : undefined} />
      {state.error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{state.error}</p>}
      <DialogButtons pending={pending} saveLabel="Добавить этап" onCancel={dlg?.close} />
      {guard}
    </form>
  );
}

const textBtn = "h-7 px-2 text-xs";

/** Действия этапа в ленте: «Выполнено» (для ожидаемого), «+ Документ», «Изменить», «Удалить» — мелкие текстовые кнопки. */
export function EventActions({ v, titles, people, canDone }: { v: EventValues; canDone: boolean } & Common) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { ask, node } = useConfirm();

  return (
    <div className="flex flex-wrap items-center justify-end gap-0.5">
      {v.expected && canDone && (
        <Button type="button" size="sm" variant="outline" className={textBtn} disabled={pending}
          onClick={() => start(async () => { setError(null); const r = await markEventDone(v.id); if (r.error) return setError(r.error); router.refresh(); })}>
          {pending ? "…" : "Выполнено"}
        </Button>
      )}
      <Button type="button" size="sm" variant="ghost" className={textBtn} onClick={() => setDocOpen(true)} title="Прикрепить файл к этапу">+ Документ</Button>
      <Button type="button" size="sm" variant="ghost" className={textBtn} onClick={() => setOpen(true)} title="Изменить этап" aria-label="Изменить этап"><IconPencil /></Button>
      <Button type="button" size="sm" variant="ghost" className={textBtn + " text-red-700"} disabled={pending} title="Удалить этап" aria-label="Удалить этап"
        onClick={async () => {
          if (!(await ask(`Удалить этап «${v.title}»? Загруженные к нему документы тоже будут удалены.`, { ok: "Удалить", danger: true }))) return;
          start(async () => { setError(null); const r = await deleteEvent(v.id); if (r.error) return setError(r.error); router.refresh(); });
        }}>
        <IconTrash />
      </Button>
      <EditDialog key={v.version} open={open} onOpenChange={setOpen} title="Изменить этап" hint="Правка попадает в журнал изменений." action={updateEvent.bind(null, v.id)} wide>
        <EventFields titles={titles} people={people} initial={v} />
      </EditDialog>
      <EditDialog open={docOpen} onOpenChange={setDocOpen} title="Прикрепить документ" hint={v.title} saveLabel="Загрузить" action={uploadEventDocument.bind(null, v.id)}>
        <FileField label="Файл" />
        <Field label="Название документа (необязательно)" wide>
          <Input name="title" maxLength={200} placeholder="по умолчанию — имя файла" />
        </Field>
      </EditDialog>
      {error && <span role="alert" className="w-full text-right text-xs text-red-600">{error}</span>}
      {node}
    </div>
  );
}

/** Крестик у документа этапа: убрать файл (с подтверждением). */
export function DocRemove({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const { ask, node } = useConfirm();
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" disabled={pending} aria-label={`Убрать документ ${title}`} title="Убрать документ"
        className="ml-1 rounded px-1 text-neutral-400 hover:bg-neutral-100 hover:text-red-700"
        onClick={async () => {
          if (!(await ask(`Убрать документ «${title}»? Файл будет удалён.`, { ok: "Убрать", danger: true }))) return;
          start(async () => { await removeEventDocument(id); router.refresh(); });
        }}>
        ×
      </button>
      {node}
    </>
  );
}

// ───────────── приёмка в Коптево ─────────────

export type AcceptRow = { label: string; quantity: number; accepted: number | null; returned: number | null; comment: string };

/** Кнопка «+ Приёмка в Коптево» (когда этапа приёмки в хронологии нет). */
export function CreateAcceptanceButton({ shipmentId }: { shipmentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" disabled={pending}
        onClick={() => start(async () => { setError(null); const r = await createAcceptanceEvent(shipmentId); if (r.error) return setError(r.error); router.refresh(); })}>
        {pending ? "Добавляем…" : "+ Приёмка в Коптево"}
      </Button>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Крупная кнопка «ЗАКРЫТЬ ПРИЁМКУ» (окно: дата-время, кто принял, на ком, комментарий и сводка). Активна, когда все строки списка отмечены. */
export function AcceptCloseButton({ shipmentId, event, rows, totals, names, disabled, disabledReason }: {
  shipmentId: string;
  event: { id: string; stamp: string };
  rows: AcceptRow[];
  totals: { inShipment: number; accepted: number; returned: number; filledLines: number };
  names: string[];
  disabled?: boolean;
  disabledReason?: string;
}) {
  const namesId = useId();
  return (
    <EditDialog
      label="ЗАКРЫТЬ ПРИЁМКУ"
      variant="default"
      className="h-12 bg-emerald-600 px-10 text-base font-bold tracking-wide text-white hover:bg-emerald-700 disabled:bg-neutral-300 max-md:w-full"
      title="Закрыть приёмку в Коптево"
      hint="Этап приёмки станет выполненным, отгрузка получит статус «Принята», внизу появится итог поставки."
      saveLabel="Закрыть приёмку"
      action={confirmAcceptance.bind(null, shipmentId, event.id)}
      disabled={disabled}
      disabledReason={disabledReason}
      wide
    >
      <AcceptFields shipmentId={shipmentId} rows={rows} totals={totals} namesId={namesId} names={names} />
    </EditDialog>
  );
}

function AcceptFields({ shipmentId, rows, totals, namesId, names }: { shipmentId: string; rows: AcceptRow[]; totals: { inShipment: number; accepted: number; returned: number; filledLines: number }; namesId: string; names: string[] }) {
  const router = useRouter();
  const [now] = useState(() => wallNow());
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const empty = totals.filledLines === 0;
  return (
    <>
      <Field label="Дата приёмки"><Input name="date" type="date" required defaultValue={wallDateIso(now)} /></Field>
      <Field label="Время"><Input name="time" type="time" defaultValue={wallTimeHm(now)} /></Field>
      <Field label="Кто принял">
        <Input name="acceptedBy" maxLength={120} list={namesId} autoComplete="off" placeholder="например: Анна" />
        <datalist id={namesId}>{names.map((n) => <option key={n} value={n} />)}</datalist>
      </Field>
      <Field label="На ком">
        <Select name="side" required defaultValue="CUM">
          {SIDES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
      </Field>
      <Field label="Комментарий" wide><Textarea name="comment" rows={2} maxLength={1000} /></Field>

      <div className="flex flex-col gap-2 sm:col-span-2">
        <h3 className="text-xs font-medium text-neutral-700">По строкам списка на приёмке</h3>
        {empty ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span className="mr-auto">Сначала отметьте «Принято» / «Не принято» в блоке «Приёмка в Коптево» (и нажмите «Сохранить»).</span>
            <Button type="button" size="sm" variant="outline" disabled={pending}
              onClick={() => start(async () => { setErr(null); const r = await acceptAllLines(shipmentId); if (r.error) return setErr(r.error); router.refresh(); })}>
              {pending ? "…" : "Принять все по списку"}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-neutral-500">Берутся сохранённые значения. Не сохранённые в блоке приёмки правки сюда не попадут.</p>
        )}
        {err && <p role="alert" className="text-xs text-red-600">{err}</p>}
        <div className="max-h-[34vh] overflow-auto rounded-md border border-neutral-200">
          <table className="w-full min-w-[480px] text-xs">
            <thead className="sticky top-0 bg-neutral-50 text-left text-neutral-500">
              <tr><th className="px-2 py-1.5">Строка</th><th className="px-2 py-1.5 text-right">В отгрузке</th><th className="px-2 py-1.5 text-right">Принято</th><th className="px-2 py-1.5 text-right">Возврат</th><th className="px-2 py-1.5">Комментарий</th></tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="px-2 py-1">{r.label}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.quantity}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.accepted ?? "—"}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.returned ?? "—"}</td>
                  <td className="px-2 py-1">{r.comment}</td>
                </tr>
              ))}
              <tr className="bg-neutral-50 font-medium">
                <td className="px-2 py-1">Всего, шт.</td>
                <td className="px-2 py-1 text-right tabular-nums">{totals.inShipment}</td>
                <td className="px-2 py-1 text-right tabular-nums">{totals.accepted}</td>
                <td className="px-2 py-1 text-right tabular-nums">{totals.returned}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/** Оболочка блока «ИТОГ ПОСТАВКИ»: сворачивается; «Отменить приёмку» (с подтверждением). Содержимое считает страница. */
export function SummaryShell({ shipmentId, canEdit, subtitle, children }: { shipmentId: string; canEdit: boolean; subtitle: string; children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { ask, node } = useConfirm();
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-emerald-300 bg-emerald-50/40 p-4" aria-label="Итог поставки" data-delivery-summary>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-touch-ok className="flex min-w-0 items-start gap-1 text-left">
          <span aria-hidden className={"mt-0.5 inline-block w-3 transition-transform " + (open ? "rotate-90" : "")}>›</span>
          <span>
            <span className="block text-base font-bold uppercase tracking-wide text-emerald-900">Итог поставки</span>
            <span className="block text-xs text-neutral-600">{subtitle}</span>
          </span>
        </button>
        {canEdit && (
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={pending}
            onClick={async () => {
              if (!(await ask("Отменить приёмку? Этап снова станет ожидаемым, итог поставки исчезнет. Отметки «Принято» и «Возврат» в списке приёмки останутся.", { ok: "Отменить приёмку", danger: true }))) return;
              start(async () => { setError(null); const r = await cancelAcceptance(shipmentId); if (r.error) return setError(r.error); router.refresh(); });
            }}>
            Отменить приёмку
          </Button>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className={open ? "flex flex-col gap-4" : "hidden"}>{children}</div>
      {node}
    </section>
  );
}

/** Детализация этапа: одна-две строки, длинную можно раскрыть («ещё»). */
export function ClampText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 150 || text.split("\n").length > 2;
  return (
    <div className="text-sm text-neutral-700">
      <p className={"whitespace-pre-wrap break-words " + (long && !open ? "line-clamp-2" : "")}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-blue-700 hover:underline" aria-expanded={open}>
          {open ? "свернуть" : "ещё"}
        </button>
      )}
    </div>
  );
}
