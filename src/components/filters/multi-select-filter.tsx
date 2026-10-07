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
  const summary = none ? allLabel : value.length === 1 ? labelOf(value[0]) : `Выбрано ${value.length}`;

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
  const row = "flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-neutral-50";

  return (
    <details
      ref={box}
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
        if (!e.currentTarget.open) setQuery("");
      }}
      className={cn("group relative min-w-0 max-sm:w-full", className)}
    >
      <summary
        title={title}
        aria-label={`${label}: ${summary}`}
        className={cn(
          "flex h-11 min-w-[140px] cursor-pointer list-none items-center justify-between gap-2 rounded-lg border bg-white px-3 text-left text-sm hover:border-neutral-400 [&::-webkit-details-marker]:hidden",
          none ? "border-neutral-300" : "border-neutral-900",
        )}
      >
        <span className="min-w-0">
          <span className="block text-[10px] font-semibold uppercase leading-tight tracking-wide text-neutral-400">{label}</span>
          <span className="block max-w-[180px] truncate font-medium leading-tight text-neutral-900 max-sm:max-w-[60vw]">{summary}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {!none && <span className="rounded-full bg-neutral-900 px-1.5 text-[11px] font-medium leading-5 text-white">{value.length}</span>}
          <span aria-hidden className="text-neutral-400 transition-transform group-open:rotate-180">⌄</span>
        </span>
      </summary>
      <div
        className={cn(
          "absolute z-40 mt-1 w-[min(320px,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white p-2 shadow-xl",
          align === "right" ? "right-0" : "left-0",
        )}
      >
        {list.length >= searchFrom && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск в списке…"
            aria-label={`Поиск: ${label}`}
            className="mb-1 h-9 w-full rounded-md border border-neutral-300 px-2 text-sm outline-none focus:border-neutral-500"
          />
        )}
        <label className={cn(row, "font-medium")}>
          <input type={single ? "radio" : "checkbox"} name={single ? name : undefined} value="" checked={none} onChange={() => onChange([])} className="size-4 accent-neutral-900" />
          <span className="min-w-0 flex-1 truncate">{allLabel}</span>
          <span className="text-xs font-normal text-neutral-400">{list.length}</span>
        </label>
        <div className="max-h-64 overflow-auto border-t border-neutral-100 pt-1">
          {shown.map((o) => (
            <label key={o.value} className={row}>
              <input
                type={single ? "radio" : "checkbox"}
                name={name}
                value={o.value}
                checked={set.has(o.value)}
                onChange={() => pick(o.value)}
                className="size-4 accent-neutral-900"
              />
              <span className={cn("min-w-0 flex-1 truncate", o.count === 0 && "text-neutral-400", o.value === NONE && "italic")} title={o.title ?? o.label}>
                {o.label}
              </span>
              {o.count != null && <span className="text-xs tabular-nums text-neutral-400">{o.count}</span>}
            </label>
          ))}
          {shown.length === 0 && <div className="px-2 py-3 text-sm text-neutral-400">Ничего не найдено</div>}
        </div>
        {!single && (
          <div className="mt-1 flex justify-between border-t border-neutral-100 px-2 pt-2 text-xs">
            <button
              type="button"
              className="text-blue-600 hover:underline disabled:text-neutral-300 disabled:no-underline"
              disabled={shown.length === 0 || shown.length === list.length && !q}
              onClick={() => onChange(Array.from(new Set([...value, ...shown.map((o) => o.value)])))}
            >
              Выбрать показанные{q ? ` (${shown.length})` : ""}
            </button>
            <button type="button" className="text-blue-600 hover:underline disabled:text-neutral-300 disabled:no-underline" disabled={none} onClick={() => onChange([])}>
              Сбросить
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
