"use client";

// Управление своими столбцами таблицы лотов и редактирование значений по месту.
import { useEffect, useRef, useState, useTransition } from "react";
import {
  FIELD_NAME_MAX,
  FIELD_TYPE_LABELS,
  MAX_CUSTOM_FIELDS,
  TEXT_VALUE_MAX,
  formatExtra,
  type CustomFieldDef,
  type CustomFieldType,
} from "@/lib/custom-fields";
import type { LotRow } from "@/lib/lot-table";
import { createCustomField, deleteCustomField, moveCustomField, renameCustomField, setCustomValue } from "./custom-field-actions";
import { useLots } from "./lots-state";

const iconBtn =
  "inline-flex h-8 min-h-8 min-w-8 items-center justify-center rounded border border-neutral-200 bg-white px-1 text-xs font-normal normal-case text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 sm:h-6 sm:min-h-6 sm:min-w-6";

/** Модальное окно: создать столбец (название + тип) или переименовать. */
function FieldDialog({
  mode,
  field,
  beforeId,
  onClose,
}: {
  mode: "create" | "rename";
  field?: CustomFieldDef;
  beforeId?: string | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(field?.name ?? "");
  const [type, setType] = useState<CustomFieldType>("TEXT");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      const r =
        mode === "create"
          ? await createCustomField({ name, type, beforeId: beforeId ?? null })
          : await renameCustomField(field!.id, name);
      if (r.ok) onClose();
      else setError(r.error);
    });
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
      className="m-auto w-[22rem] max-w-[95vw] rounded-lg border border-neutral-200 bg-white p-0 text-left text-sm font-normal normal-case tracking-normal text-neutral-800 shadow-xl backdrop:bg-black/30"
    >
      <form onSubmit={submit} className="flex flex-col gap-3 p-4">
        <p className="text-sm font-semibold">{mode === "create" ? "Новый столбец" : "Переименовать столбец"}</p>
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          Название (до {FIELD_NAME_MAX} символов)
          <input
            autoFocus
            value={name}
            maxLength={FIELD_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например, Седина"
            className="h-9 rounded-md border border-neutral-300 px-2 text-sm text-neutral-900"
          />
        </label>
        {mode === "create" && (
          <fieldset className="flex flex-col gap-1 text-xs text-neutral-600">
            <legend className="mb-1">Тип значений</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(FIELD_TYPE_LABELS) as CustomFieldType[]).map((t) => (
                <label
                  key={t}
                  className={`relative flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1.5 text-sm ${type === t ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
                >
                  <input type="radio" name="ftype" className="sr-only" checked={type === t} onChange={() => setType(t)} />
                  {FIELD_TYPE_LABELS[t]}
                </label>
              ))}
            </div>
            <span className="text-neutral-400">
              Столбец появится у всех счетов и лотов организации (не больше {MAX_CUSTOM_FIELDS}). Числовые столбцы идут в строку «Итого».
            </span>
          </fieldset>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => ref.current?.close()} className="h-9 rounded-md border border-neutral-300 px-3 text-sm hover:bg-neutral-50">
            Отмена
          </button>
          <button type="submit" disabled={pending} className="h-9 rounded-md bg-neutral-900 px-3 text-sm text-white hover:bg-neutral-700 disabled:opacity-50">
            {pending ? "Сохраняю…" : mode === "create" ? "Создать" : "Сохранить"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Кнопка «+»: добавить столбец перед beforeId (или в конец). */
export function AddFieldButton({ beforeId, label }: { beforeId?: string | null; label?: string }) {
  const { canEdit } = useLots();
  const [open, setOpen] = useState(false);
  if (!canEdit) return null;
  return (
    <>
      <button
        type="button"
        data-add-column
        onClick={() => setOpen(true)}
        title={beforeId ? "Добавить столбец перед этим" : "Добавить свой столбец"}
        aria-label="Добавить столбец"
        className={label ? "inline-flex h-8 items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium hover:bg-neutral-50" : `${iconBtn} font-semibold`}
      >
        +{label ? <span>{label}</span> : null}
      </button>
      {open && <FieldDialog mode="create" beforeId={beforeId} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Содержимое заголовка своего столбца: название, тип, стрелки, переименование, удаление. */
export function CustomFieldHeader({ field, index, count }: { field: CustomFieldDef; index: number; count: number }) {
  const { canEdit } = useLots();
  const [renaming, setRenaming] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>) =>
    start(async () => {
      setErr("");
      const r = await fn();
      if (!r.ok && r.error) setErr(r.error);
    });

  return (
    <div className="flex min-w-24 flex-col gap-1">
      <div className="flex items-center gap-1">
        {canEdit && <AddFieldButton beforeId={field.id} />}
        <span className="min-w-0 break-words">{field.name}</span>
        <span className="rounded bg-neutral-100 px-1 text-[10px] font-normal normal-case text-neutral-500">{FIELD_TYPE_LABELS[field.type]}</span>
      </div>
      {canEdit && (
        <div className="flex gap-1">
          <button type="button" className={iconBtn} disabled={pending || index === 0} title="Сдвинуть влево" onClick={() => run(() => moveCustomField(field.id, "left"))}>
            ←
          </button>
          <button type="button" className={iconBtn} disabled={pending || index === count - 1} title="Сдвинуть вправо" onClick={() => run(() => moveCustomField(field.id, "right"))}>
            →
          </button>
          <button type="button" className={iconBtn} disabled={pending} title="Переименовать" onClick={() => setRenaming(true)}>
            ✎
          </button>
          <button
            type="button"
            className={`${iconBtn} text-red-600`}
            disabled={pending}
            title="Удалить столбец"
            onClick={() => {
              if (window.confirm(`Удалить столбец «${field.name}»? Значения этого столбца у всех лотов будут удалены безвозвратно.`))
                run(() => deleteCustomField(field.id));
            }}
          >
            ✕
          </button>
        </div>
      )}
      {err && <span className="max-w-40 whitespace-normal text-[10px] font-normal normal-case text-red-600">{err}</span>}
      {renaming && <FieldDialog mode="rename" field={field} onClose={() => setRenaming(false)} />}
    </div>
  );
}

/** Ячейка значения: клик -> ввод -> Enter / потеря фокуса сохраняет, Esc отменяет. */
export function CustomCell({ row, field }: { row: LotRow; field: CustomFieldDef }) {
  const { extraOf, setExtra, canEdit } = useLots();
  const value = extraOf(row, field.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const cancelled = useRef(false);
  const saving = useRef(false);

  const shown = formatExtra(field.type, value);
  const original = field.type === "NUMBER" && typeof value === "number" ? String(value).replace(".", ",") : typeof value === "string" ? value : "";

  function save(raw: string | boolean | null) {
    if (saving.current) return;
    saving.current = true;
    setErr("");
    start(async () => {
      const r = await setCustomValue(row.id, field.id, raw);
      saving.current = false;
      if (r.ok) {
        setExtra(row.id, field.id, r.value);
        setEditing(false);
      } else setErr(r.error);
    });
  }

  if (field.type === "BOOLEAN") {
    if (!canEdit) return <span>{shown || <span className="text-neutral-300">—</span>}</span>;
    return (
      <div>
        <select
          aria-label={field.name}
          value={value === true ? "true" : value === false ? "false" : ""}
          disabled={pending}
          onChange={(e) => save(e.target.value === "" ? null : e.target.value === "true")}
          className="h-7 rounded border border-neutral-200 bg-white px-1 text-xs"
        >
          <option value="">—</option>
          <option value="true">Да</option>
          <option value="false">Нет</option>
        </select>
        {err && <div className="max-w-40 whitespace-normal text-[10px] text-red-600">{err}</div>}
      </div>
    );
  }

  if (!editing) {
    if (!canEdit) return <span>{shown || <span className="text-neutral-300">—</span>}</span>;
    return (
      <button
        type="button"
        title="Нажмите, чтобы изменить"
        onClick={() => {
          cancelled.current = false;
          setDraft(original);
          setErr("");
          setEditing(true);
        }}
        className="min-h-8 min-w-16 cursor-text sm:min-h-6 rounded px-1 text-left hover:bg-neutral-100"
      >
        {shown || <span className="text-neutral-300">—</span>}
      </button>
    );
  }

  return (
    <div>
      <input
        autoFocus
        value={draft}
        disabled={pending}
        inputMode={field.type === "NUMBER" ? "decimal" : "text"}
        maxLength={field.type === "TEXT" ? TEXT_VALUE_MAX : 24}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            cancelled.current = true;
            setEditing(false);
            setErr("");
          }
        }}
        onBlur={() => {
          if (cancelled.current) return;
          if (draft.trim() === original.trim()) {
            setEditing(false);
            return;
          }
          save(draft);
        }}
        className="h-7 w-28 rounded border border-neutral-400 bg-white px-1 text-sm"
      />
      {err && <div className="max-w-40 whitespace-normal text-[10px] text-red-600">{err}</div>}
    </div>
  );
}
