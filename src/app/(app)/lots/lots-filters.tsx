"use client";

// Панель фильтров лотов: выпадающие списки с мультивыбором и поиском (мех, размер, операция),
// подстрока, диапазоны «от / до», да/нет для своих столбцов.
import { useMemo } from "react";
import { MultiSelectFilter } from "@/components/filters/multi-select-filter";
import { MULTI_KEYS, isBoundValid, multiValue, type Filters, type MultiKey, type Range } from "@/lib/lot-table";
import { useLots, useScope } from "./lots-state";

const inputCls = "ui-field h-11 w-full min-w-0 rounded-lg border border-neutral-300 bg-white px-3 text-xs text-neutral-900 placeholder:text-neutral-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900";
const labelCls = "mb-1 block min-w-0 break-words text-[10px] font-semibold uppercase leading-tight tracking-[0.02em] text-neutral-600";

const MULTI_LABELS: Record<MultiKey, string> = { material: "Мех", size: "Размер / описание", op: "Операция" };

function RangeInput({ label, value, onChange }: { label: string; value: Range | undefined; onChange: (r: Range) => void }) {
  const v = value ?? { from: "", to: "" };
  const bad = "border-red-500 bg-red-50 text-red-700";
  const badFrom = !isBoundValid(v.from);
  const badTo = !isBoundValid(v.to);
  return (
    <div className="min-w-0">
      <span className={labelCls}>{label}</span>
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
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {MULTI_KEYS.map((k) => (
          <MultiSelectFilter
            key={k}
            name={`lot-${k}`}
            label={MULTI_LABELS[k]}
            options={options[k].map((o) => ({ value: o.value, label: o.value, count: o.count }))}
            value={f.multi[k] ?? []}
            onChange={(v) => set({ multi: { ...f.multi, [k]: v } })}
            searchFrom={1}
          />
        ))}
        <label className="block min-w-0">
          <span className={labelCls}>№ лота (подстрока)</span>
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
              <span className={labelCls}>{fld.name} (подстрока)</span>
              <input value={f.text[fld.id] ?? ""} onChange={(e) => set({ text: { ...f.text, [fld.id]: e.target.value } })} className={inputCls} />
            </label>
          ) : fld.type === "NUMBER" ? (
            rng(fld.id, fld.name)
          ) : (
            <MultiSelectFilter
              key={fld.id}
              name={`lot-bool-${fld.id}`}
              label={fld.name}
              single
              options={[{ value: "yes", label: "Да" }, { value: "no", label: "Нет" }]}
              value={f.bool[fld.id] ? [f.bool[fld.id]] : []}
              onChange={(v) => {
                const bool = { ...f.bool };
                if (v[0] === "yes" || v[0] === "no") bool[fld.id] = v[0];
                else delete bool[fld.id];
                set({ bool });
              }}
            />
          ),
        )}
      </div>
    </div>
  );
}
