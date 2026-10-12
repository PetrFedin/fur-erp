"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { NONE, type FilterOption } from "@/lib/filters";

/**
 * Выпадающий список с галочками: пункт «Все», поиск внутри списка, счётчик выбранного, «Выбрать показанные»,
 * «Сбросить», значение none («Без …»), режим single (один пункт, как обычный select).
 * Пустой выбор = «Все». Меняет выбор сразу (onChange на каждый клик; страница пересчитывается без кнопки «Применить»).
 * Работает и без JS: список — <details>, пункты — input с name (повтор параметра), форма отправляется GET.
 */
export function MultiSelectFilter({
  name,
  label,
  options,
  value,
  onChange,
  single = false,
  noneLabel,
  allLabel = "Все",
  align = "left",
  searchFrom = 6,
  className,
  title,
  nouns = ["партия", "партии", "партий"],
}: {
  /** Имя параметра адреса (для GET-формы без JS). */
  name: string;
  label: string;
  options: FilterOption[];
  value: string[];
  onChange: (next: string[]) => void;
  single?: boolean;
  /** Подпись пункта «Без …» (значение none): записи, у которых поле не заполнено. */
  noneLabel?: string;
  allLabel?: string;
  align?: "left" | "right";
  /** С какого числа вариантов показывать поиск. */
  searchFrom?: number;
  className?: string;
  title?: string;
  /** Формы слова для подписи «5 партий» в списке с группировкой (1 / 2–4 / 5+). */
  nouns?: [string, string, string];
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDetailsElement>(null);

  const all = useMemo<FilterOption[]>(() => (noneLabel ? [...options, { value: NONE, label: noneLabel }] : options), [options, noneLabel]);
  // Выбранные значения, которых нет среди вариантов (например, аукцион другого года), остаются в списке — чтобы их можно было снять.
  const known = useMemo(() => new Set(all.map((o) => o.value)), [all]);
  const extra = value.filter((v) => !known.has(v)).map<FilterOption>((v) => ({ value: v, label: v, count: 0 }));
  const list = extra.length ? [...extra, ...all] : all;

  const q = query.trim().toLowerCase();
  const shown = q ? list.filter((o) => o.label.toLowerCase().includes(q) || (o.title ?? "").toLowerCase().includes(q)) : list;
  const set = new Set(value);
  const none = value.length === 0;
  const labelOf = (v: string) => list.find((o) => o.value === v)?.label ?? v;
  // Список с группировкой (годы партий): группы идут в порядке появления в options; «Без …» (none) — отдельной строкой вне групп.
  const grouped = !single && all.some((o) => o.group);
  const buildGroups = () => {
    if (!grouped) return [] as { label: string; items: FilterOption[] }[];
    const m = new Map<string, FilterOption[]>();
    for (const o of list) {
      if (o.value === NONE) continue;
      const g = o.group ?? "Без года";
      m.set(g, [...(m.get(g) ?? []), o]);
    }
    // Годы — от новых к старым, «Без года» (и прочие нечисловые) — в конце.
    return Array.from(m, ([label, items]) => ({ label, items })).sort((a, b) => (/^\d{4}$/.test(b.label) ? Number(b.label) : -1) - (/^\d{4}$/.test(a.label) ? Number(a.label) : -1));
  };
  const groups = buildGroups();
  const plural = (n: number) => { const a = n % 100, b = n % 10; return a > 10 && a < 20 ? nouns[2] : b === 1 ? nouns[0] : b >= 2 && b <= 4 ? nouns[1] : nouns[2]; };
  const groupSummary = () => {
    const hasNone = value.includes(NONE);
    const touched = groups.filter((g) => g.items.some((o) => set.has(o.value)));
    if (touched.length === 1 && !hasNone) {
      const g = touched[0];
      const n = g.items.filter((o) => set.has(o.value)).length;
      if (n === g.items.length && g.items.length > 1) return `${g.label} (все)`;
      if (n > 1) return `${g.label} · ${n} из ${g.items.length}`;
    }
    return `${value.length} ${plural(value.length)}`;
  };
  const summary = none ? allLabel : value.length === 1 ? labelOf(value[0]) : grouped ? groupSummary() : `Выбрано ${value.length}`;

  useEffect(() => {
    if (!open) return;
    const close = () => {
      if (box.current) box.current.open = false;
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  const pick = (v: string) => {
    if (single) {
      onChange(set.has(v) ? [] : [v]);
      if (box.current) box.current.open = false;
    } else onChange(set.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  };
  const toggleGroup = (items: FilterOption[]) => {
    const ids = items.map((o) => o.value);
    const full = ids.every((v) => set.has(v));
    onChange(full ? value.filter((v) => !ids.includes(v)) : Array.from(new Set([...value, ...ids])));
  };
  const row = "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm leading-snug text-neutral-900 hover:bg-neutral-100 has-[:checked]:bg-neutral-50 has-[:checked]:font-medium";

  const itemRow = (o: FilterOption, nested = false) => (
    <label key={o.value} className={cn(row, nested && "pl-7")}>
      <input type={single ? "radio" : "checkbox"} name={name} value={o.value} checked={set.has(o.value)} onChange={() => pick(o.value)} className="size-4 accent-neutral-900" />
      <span className={cn("min-w-0 flex-1 truncate", o.count === 0 && "text-neutral-500", o.value === NONE && "italic")} title={o.title ?? o.label}>
        {o.label}
      </span>
      {o.count != null && <span className="text-xs tabular-nums text-neutral-600">{o.count}</span>}
    </label>
  );
  // Под поиск подходят и название года (по «2026» показываются все партии года), и название партии.
  const visibleGroups = grouped
    ? groups
        .map((g) => ({ label: g.label, items: !q || g.label.toLowerCase().includes(q) ? g.items : g.items.filter((o) => shown.includes(o)) }))
        .filter((g) => g.items.length > 0)
    : [];
  const noneItem = shown.find((o) => o.value === NONE);
  const pickShown = grouped ? Array.from(new Set(visibleGroups.flatMap((g) => g.items.map((o) => o.value)).concat(noneItem ? [NONE] : []))) : shown.map((o) => o.value);

  return (
    <details
      ref={box}
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
        if (!e.currentTarget.open) setQuery("");
      }}
      className={cn("group relative min-w-0 max-sm:w-full sm:flex-1 sm:basis-40", className)}
    >
      <summary
        title={title}
        aria-label={`${label}: ${summary}`}
        data-active={none ? undefined : ""}
        className="ui-field flex h-11 w-full min-w-0 cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-neutral-300 bg-white px-3 text-left text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 [&::-webkit-details-marker]:hidden"
      >
        <span className="min-w-0 flex-1">
          <span className="mb-0.5 block truncate text-[10px] font-semibold uppercase leading-none tracking-[0.02em] text-neutral-600">{label}</span>
          <span className="block truncate text-xs font-normal leading-tight text-neutral-800">{summary}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {!none && <span className="rounded-full bg-neutral-900 px-1.5 text-[11px] font-medium leading-5 text-white">{value.length}</span>}
          <span aria-hidden className="text-neutral-500 transition-transform group-open:rotate-180">⌄</span>
        </span>
      </summary>
      <div
        className={cn(
          "absolute z-40 mt-1.5 w-[min(360px,calc(100vw-2rem))] rounded-xl border border-neutral-300 bg-white p-2 shadow-xl",
          align === "right" ? "right-0" : "left-0",
        )}
      >
        {(grouped || list.length >= searchFrom) && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск в списке…"
            aria-label={`Поиск: ${label}`}
            className="mb-2 h-10 w-full rounded-lg border border-neutral-400 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-500 focus-visible:border-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          />
        )}
        <label className={cn(row, "font-medium")}>
          <input type={single ? "radio" : "checkbox"} name={single ? name : undefined} value="" checked={none} onChange={() => onChange([])} className="size-4 accent-neutral-900" />
          <span className="min-w-0 flex-1 truncate">{allLabel}</span>
          <span className="text-xs font-normal tabular-nums text-neutral-600">{list.length}</span>
        </label>
        <div className="mt-1 max-h-72 overflow-auto border-t border-neutral-200 pt-1">
          {grouped
            ? visibleGroups.map((g) => {
                const n = g.items.filter((o) => set.has(o.value)).length;
                const full = n === g.items.length;
                return (
                  <div key={g.label} role="group" aria-label={`${label}: ${g.label}`}>
                    <label className={cn(row, "sticky top-0 z-10 bg-neutral-100 font-semibold hover:bg-neutral-200")}>
                      <input
                        type="checkbox"
                        checked={full}
                        aria-checked={full ? true : n > 0 ? "mixed" : false}
                        ref={(el) => { if (el) el.indeterminate = n > 0 && !full; }}
                        onChange={() => toggleGroup(g.items)}
                        aria-label={`${g.label}: весь год`}
                        className="size-4 accent-neutral-900"
                      />
                      <span className="min-w-0 flex-1 truncate">{g.label}</span>
                      <span className="text-[11px] font-normal text-neutral-600">{n > 0 && !full ? `${n} из ${g.items.length}` : full ? "весь год" : `${g.items.length}`}</span>
                    </label>
                    {g.items.map((o) => itemRow(o, true))}
                  </div>
                );
              })
            : shown.map((o) => itemRow(o))}
          {grouped && noneItem && itemRow(noneItem)}
          {shown.length === 0 && <div className="px-2 py-3 text-sm text-neutral-500">Ничего не найдено</div>}
        </div>
        {!single && (
          <div className="mt-1 flex justify-between gap-2 border-t border-neutral-200 pt-1.5 text-sm">
            <button
              type="button"
              className="min-h-9 rounded-md px-2 font-medium text-blue-700 hover:bg-blue-50 hover:underline disabled:text-neutral-400 disabled:no-underline disabled:hover:bg-transparent"
              disabled={pickShown.length === 0 || (shown.length === list.length && !q && grouped ? list.every((o) => set.has(o.value)) : shown.length === list.length && !q && !grouped)}
              onClick={() => onChange(Array.from(new Set([...value, ...pickShown])))}
            >
              {grouped && !q ? "Выбрать всё" : `Выбрать показанные${q ? ` (${pickShown.length})` : ""}`}
            </button>
            <button type="button" className="min-h-9 rounded-md px-2 font-medium text-blue-700 hover:bg-blue-50 hover:underline disabled:text-neutral-400 disabled:no-underline disabled:hover:bg-transparent" disabled={none} onClick={() => onChange([])}>
              Сбросить
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
