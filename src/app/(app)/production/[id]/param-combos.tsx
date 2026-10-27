"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-dialog";
import { CATEGORY_GROUPS, NO_GROUP } from "@/lib/category-groups";
import { createCategoryInline } from "@/app/(app)/settings/categories/actions";
import { createFurInline } from "@/app/(app)/settings/furs/actions";
import { SaveMark, useSaver, type CellResult, type SelectOpt } from "./inline-cell";

const BOX =
  "w-full min-w-[3.25rem] rounded border bg-white px-1.5 py-0.5 text-sm outline-none transition-colors disabled:cursor-default disabled:opacity-60 " +
  "border-neutral-200 hover:border-neutral-400 focus:border-neutral-700 focus:ring-1 focus:ring-neutral-300";
const NEW = "__new__";

/**
 * Выбор из списка ИЛИ внесение своего значения: «＋ Внести своё…» раскрывает поле ввода.
 * onCreate (если есть) сначала заводит значение в справочник и возвращает итоговое значение, затем оно сохраняется через onPick.
 */
function PickOrAdd({
  value, options, emptyLabel, label, onPick, onCreate, addLabel = "＋ Внести своё…", placeholder, type = "text", suffix, extraStatus, confirmPick,
}: {
  /** Явное подтверждение выбора окном «что изменится» (вместо обычного подтверждения завершённого ТЗ); false — выбор отменён. */
  confirmPick?: (v: string) => Promise<boolean>;
  value: string;
  options: SelectOpt[];
  emptyLabel: string;
  label: string;
  onPick: (v: string) => Promise<CellResult>;
  onCreate?: (text: string) => Promise<{ ok: true; value: string } | { ok: false; error: string }>;
  addLabel?: string;
  placeholder?: string;
  type?: "text" | "number";
  suffix?: string;
  extraStatus?: string | null;
}) {
  const { pending, error, save: rawSave, saved } = useSaver(onPick, value, !!confirmPick);
  const save = async (v: string, revert: () => void) => {
    if (confirmPick && v.trim() !== value.trim() && !(await confirmPick(v))) { revert(); return; }
    rawSave(v, revert);
  };
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [localErr, setLocalErr] = useState<string | null>(null);
  if (seen !== value) { setSeen(value); setDraft(value); }
  const err = localErr ?? error;
  const all = value && !options.some((o) => o.value === value) ? [...options, { value, label: value }] : options;
  const submit = async () => {
    const v = text.trim();
    if (!v) { setLocalErr("Введите значение"); return; }
    setLocalErr(null);
    if (onCreate) {
      const r = await onCreate(v);
      if (!r.ok) { setLocalErr(r.error); return; }
      setAdding(false); setText(""); setDraft(r.value);
      save(r.value, () => setDraft(value));
    } else {
      setAdding(false); setText(""); setDraft(v);
      save(v, () => setDraft(value));
    }
  };
  return (
    <span className="block">
      <select
        value={adding ? NEW : draft}
        aria-label={label}
        title={err ?? label}
        disabled={pending}
        onChange={(e) => {
          if (e.target.value === NEW) { setAdding(true); setLocalErr(null); return; }
          setAdding(false);
          setDraft(e.target.value);
          save(e.target.value, () => setDraft(value));
        }}
        className={cn(BOX, err && "border-red-500 bg-red-50")}
      >
        {!all.some((o) => o.value === "") ? <option value="">{emptyLabel}</option> : null}
        {all.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        <option value={NEW}>{addLabel}</option>
      </select>
      {adding ? (
        <span className="mt-1 flex items-center gap-1">
          <input
            autoFocus
            value={text}
            type={type}
            step={type === "number" ? "0.01" : undefined}
            min={type === "number" ? "0" : undefined}
            inputMode={type === "number" ? "decimal" : undefined}
            placeholder={placeholder}
            aria-label={`${label}: своё значение`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } if (e.key === "Escape") { setAdding(false); setText(""); } }}
            className={cn(BOX, type === "number" && "text-right tabular-nums")}
          />
          {suffix ? <span className="shrink-0 text-xs text-neutral-500">{suffix}</span> : null}
          <button type="button" onClick={() => void submit()} className="shrink-0 rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50">Добавить</button>
          <button type="button" onClick={() => { setAdding(false); setText(""); setLocalErr(null); }} className="shrink-0 text-xs text-neutral-500 hover:text-neutral-900">Отмена</button>
        </span>
      ) : null}
      <SaveMark pending={pending} saved={saved} />
      {extraStatus && !err ? <span className="mt-0.5 block text-[11px] text-neutral-500">{extraStatus}</span> : null}
      {err ? <span className="mt-0.5 block text-xs text-red-600">{err}</span> : null}
    </span>
  );
}

/** Вид меха ТЗ: из справочника видов меха, «Внести свой» (добавляется в справочник) или «по списаниям» (авто). */
export function FurTypeCell({
  value, furs, autoLabel, canCreate, onSave,
}: {
  value: string;
  furs: string[];
  autoLabel: string;
  canCreate: boolean;
  onSave: (v: string) => Promise<CellResult>;
}) {
  return (
    <PickOrAdd
      value={value}
      options={furs.map((f) => ({ value: f, label: f }))}
      emptyLabel={autoLabel}
      label="Вид меха"
      onPick={onSave}
      onCreate={canCreate ? async (t) => { const r = await createFurInline(t); return r.ok ? { ok: true, value: r.name } : r; } : undefined}
      addLabel={canCreate ? "＋ Внести свой вид меха…" : "＋ Ввести вид меха…"}
      placeholder="Например: Енот"
    />
  );
}

export type CategoryOpt = { id: string; name: string; group: string | null };

/**
 * Категория ТЗ в два уровня: группа (Одежда / Аксессуары) → категория из справочника или «Внести новую».
 * Категория принадлежит АРТИКУЛУ: перед сохранением спрашиваем подтверждение (изменится у артикула и у всех его ТЗ).
 */
export function CategoryCell({
  categoryRefId, categoryText, group, categories, tzCount, canCreate, onSave,
}: {
  categoryRefId: string;
  categoryText: string;
  group: string;
  categories: CategoryOpt[];
  tzCount: number;
  canCreate: boolean;
  onSave: (categoryRefId: string) => Promise<CellResult>;
}) {
  const { ask, node } = useConfirm();
  const [extra, setExtra] = useState<CategoryOpt[]>([]);
  const [grp, setGrp] = useState(group || NO_GROUP);
  const [seenGroup, setSeenGroup] = useState(group);
  if (seenGroup !== group) { setSeenGroup(group); setGrp(group || NO_GROUP); }
  const all = [...categories, ...extra.filter((e) => !categories.some((c) => c.id === e.id))];
  const inGroup = all.filter((c) => (c.group || NO_GROUP) === grp || c.id === categoryRefId);
  const groups: string[] = [...CATEGORY_GROUPS, NO_GROUP];
  const names = new Map(all.map((c) => [c.id, c.name]));
  const confirmedPick = async (id: string): Promise<CellResult> => {
    if (id === "") return {};
    const ok = await ask(`Категория изменится у артикула и у всех его ТЗ (${tzCount} шт.). Сменить на «${names.get(id) ?? "–"}»?`, { ok: "Сменить категорию" });
    if (!ok) throw new Error("Смена категории отменена");
    return onSave(id);
  };
  return (
    <span className="flex flex-col gap-1">
      <select
        value={grp}
        aria-label="Группа категории"
        title="Группа (верхний уровень): сначала группа, затем категория из неё"
        onChange={(e) => setGrp(e.target.value)}
        className={BOX}
      >
        {groups.map((g) => <option key={g} value={g}>{g === NO_GROUP ? "Без группы" : g}</option>)}
      </select>
      <PickOrAdd
        value={categoryRefId}
        options={inGroup.map((c) => ({ value: c.id, label: c.name }))}
        emptyLabel={categoryText ? `${categoryText} (нет в справочнике)` : "Категория не выбрана"}
        label="Категория"
        onPick={confirmedPick}
        onCreate={canCreate ? async (t) => {
          const r = await createCategoryInline(t, grp === NO_GROUP ? undefined : grp);
          if (!r.ok) return r;
          setExtra((p) => [...p, { id: r.id, name: r.name, group: r.group }]);
          return { ok: true, value: r.id };
        } : undefined}
        addLabel="＋ Внести новую категорию…"
        placeholder={grp === NO_GROUP ? "Название категории" : `Новая категория в группе «${grp}»`}
      />
      {node}
    </span>
  );
}

/** НДС ТЗ: ставка для всех строк списания сразу — 22, 20 или своя; «как в лотах» возвращает ставки лотов. */
export function VatCell({
  rates, lines, onSave, confirmPick,
}: {
  confirmPick?: (v: string) => Promise<boolean>;
  rates: number[];
  lines: number;
  onSave: (rate: string) => Promise<CellResult>;
}) {
  const uniform = rates.length === 1 ? String(rates[0]) : "";
  const std = ["22", "20"];
  const opts: SelectOpt[] = [...std.map((r) => ({ value: r, label: `${r} %` }))];
  if (uniform && !std.includes(uniform)) opts.push({ value: uniform, label: `${uniform} %` });
  if (lines === 0) return <span className="block px-1.5 py-0.5 text-sm text-neutral-600">нет списаний — ставку задать некому</span>;
  return (
    <PickOrAdd
      value={uniform}
      options={opts}
      emptyLabel={rates.length > 1 ? `Разные: ${rates.map((r) => `${r} %`).join(" / ")} (как в лотах)` : "Как в лотах"}
      label="НДС ТЗ, %"
      onPick={(v) => onSave(v)}
      confirmPick={confirmPick}
      addLabel="＋ Своя ставка…"
      type="number"
      suffix="%"
      placeholder="напр. 10"
      extraStatus={`Применяется ко всем строкам списания (${lines})`}
    />
  );
}
