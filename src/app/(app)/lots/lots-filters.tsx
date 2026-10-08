"use client";

// Панель фильтров лотов: выпадающие списки с мультивыбором и поиском (мех, размер, операция),
// подстрока, диапазоны «от / до», да/нет для своих столбцов.
import { useEffect, useMemo, useRef, useState } from "react";
import { MULTI_KEYS, isBoundValid, multiValue, type Filters, type MultiKey, type Range } from "@/lib/lot-table";
import { useLots, useScope } from "./lots-state";

const inputCls = "h-9 w-full min-w-0 rounded-md border border-neutral-400 bg-white px-2.5 text-sm text-neutral-900 placeholder:text-neutral-500 hover:border-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900";

const MULTI_LABELS: Record<MultiKey, string> = { material: "Мех", size: "Размер / описание", op: "Операция" };

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; count: number }[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const shown = options.filter((o) => o.value.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div className="relative" ref={box}>
      <span className="mb-1 block text-xs font-medium text-neutral-600">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`${inputCls} flex items-center justify-between gap-2 text-left ${selected.length ? "border-neutral-900 font-medium" : ""}`}
      >
        <span className="truncate">{selected.length === 0 ? "Все" : selected.length === 1 ? selected[0] : `Выбрано: ${selected.length}`}</span>
        <span className="text-neutral-500">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-neutral-300 bg-white p-2 shadow-xl">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск…" className={inputCls} />
          <div className="my-1 flex justify-between gap-2 text-sm">
            <button type="button" className="min-h-9 rounded-md px-2 font-medium text-blue-700 hover:bg-blue-50 hover:underline" onClick={() => onChange(Array.from(new Set([...selected, ...shown.map((o) => o.value)])))}>
              Выбрать показанные
            </button>
            <button type="button" className="min-h-9 rounded-md px-2 font-medium text-blue-700 hover:bg-blue-50 hover:underline" onClick={() => onChange([])}>
              Сбросить
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto border-t border-neutral-200 pt-1">
            {shown.map((o) => (
              <label key={o.value} className="flex min-h-9 cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm leading-snug text-neutral-900 hover:bg-neutral-100 has-[:checked]:bg-neutral-50 has-[:checked]:font-medium">
                <input type="checkbox" className="mt-0.5 size-4 accent-neutral-900" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                <span className="min-w-0 flex-1 break-words">{o.value}</span>
                <span className="text-xs tabular-nums text-neutral-600">{o.count}</span>
              </label>
            ))}
            {shown.length === 0 && <p className="px-2 py-2 text-sm text-neutral-500">Ничего не найдено</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function RangeInput({ label, value, onChange }: { label: string; value: Range | undefined; onChange: (r: Range) => void }) {
  const v = value ?? { from: "", to: "" };
  const bad = "border-red-500 bg-red-50 text-red-700";
  const badFrom = !isBoundValid(v.from);
  const badTo = !isBoundValid(v.to);
  return (
    <div className="min-w-0">
      <span className="mb-1 block min-w-0 break-words text-xs font-medium text-neutral-600">{label}</span>
      <div className="flex gap-1">
        <input inputMode="decimal" placeholder="от" value={v.from} aria-invalid={badFrom} title={badFrom ? "Некорректное число — фильтр не действует" : undefined} onChange={(e) => onChange({ ...v, from: e.target.value })} className={`${inputCls} ${badFrom ? bad : ""}`} />
        <input inputMode="decimal" placeholder="до" value={v.to} aria-invalid={badTo} title={badTo ? "Некорректное число — фильтр не действует" : undefined} onChange={(e) => onChange({ ...v, to: e.target.value })} className={`${inputCls} ${badTo ? bad : ""}`} />
      </div>
      {(badFrom || badTo) && <span className="mt-0.5 block text-[11px] text-red-600">Некорректное число — фильтр не действует</span>}
    </div>
  );
}

/** Панель фильтров области: счёт (scope = id закупки) или весь аукцион (ALL). */
export function FilterPanel({ scope }: { scope: string }) {
  const { fields, setFilters } = useLots();
  const view = useScope(scope);
  const f = view.filters;
  const set = (patch: Partial<Filters>) => setFilters(scope, { ...f, ...patch });

  const options = useMemo(() => {
    const out = {} as Record<MultiKey, { value: string; count: number }[]>;
    for (const k of MULTI_KEYS) {
      const m = new Map<string, number>();
      for (const r of view.all) m.set(multiValue(r, k), (m.get(multiValue(r, k)) ?? 0) + 1);
      out[k] = Array.from(m, ([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value, "ru"));
    }
    return out;
  }, [view.all]);

  const rng = (key: string, label: string) => (
    <RangeInput key={key} label={label} value={f.range[key]} onChange={(r) => set({ range: { ...f.range, [key]: r } })} />
  );

  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {MULTI_KEYS.map((k) => (
          <MultiSelect key={k} label={MULTI_LABELS[k]} options={options[k]} selected={f.multi[k] ?? []} onChange={(v) => set({ multi: { ...f.multi, [k]: v } })} />
        ))}
        <label className="block min-w-0">
          <span className="mb-1 block text-xs text-neutral-500">№ лота (подстрока)</span>
          <input value={f.text.lotNumber ?? ""} onChange={(e) => set({ text: { ...f.text, lotNumber: e.target.value } })} className={inputCls} placeholder="Часть номера" />
        </label>
        {rng("qty", "Кол-во")}
        {rng("price", "Цена за шк. (в валюте)")}
        {rng("rate", "Курс")}
        {rng("unit", "Себестоимость ед. (по режиму НДС)")}
        {rng("total", "Себестоимость всего (по режиму НДС)")}
        {rng("remaining", "Остаток на складе")}
        {fields.map((fld) =>
          fld.type === "TEXT" ? (
            <label key={fld.id} className="block min-w-0">
              <span className="mb-1 block min-w-0 break-words text-xs text-neutral-500">{fld.name} (подстрока)</span>
              <input value={f.text[fld.id] ?? ""} onChange={(e) => set({ text: { ...f.text, [fld.id]: e.target.value } })} className={inputCls} />
            </label>
          ) : fld.type === "NUMBER" ? (
            rng(fld.id, fld.name)
          ) : (
            <label key={fld.id} className="block min-w-0">
              <span className="mb-1 block min-w-0 break-words text-xs text-neutral-500">{fld.name}</span>
              <select
                value={f.bool[fld.id] ?? ""}
                onChange={(e) => {
                  const bool = { ...f.bool };
                  if (e.target.value === "yes" || e.target.value === "no") bool[fld.id] = e.target.value;
                  else delete bool[fld.id];
                  set({ bool });
                }}
                className={inputCls}
              >
                <option value="">Все</option>
                <option value="yes">Да</option>
                <option value="no">Нет</option>
              </select>
            </label>
          ),
        )}
      </div>
    </div>
  );
}
