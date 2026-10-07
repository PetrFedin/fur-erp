"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type MultiFilterOption = { value: string; label: string; count?: number };

/**
 * Фильтр-выпадающий список с галочками: пункт «Все», поиск (с задержкой ≈0,4 с), счётчик выбранного.
 * Пустой выбор = «Все». Применяется сразу при каждом клике (кнопки «Применить» нет).
 */
export function MultiFilter({
  label,
  options,
  selected,
  onChange,
  allLabel = "Все",
  align = "left",
  className,
  searchFrom = 7,
}: {
  label: string;
  options: MultiFilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  allLabel?: string;
  align?: "left" | "right";
  className?: string;
  /** С какого числа вариантов показывать поиск. */
  searchFrom?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    const t = setTimeout(() => setApplied(query.trim().toLowerCase()), 400);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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

  const shown = useMemo(
    () => (applied ? options.filter((o) => o.label.toLowerCase().includes(applied)) : options),
    [options, applied],
  );
  const set = new Set(selected);
  const all = selected.length === 0;
  const names = selected.map((v) => options.find((o) => o.value === v)?.label ?? v);
  const summary = all ? allLabel : names.length === 1 ? names[0] : `Выбрано ${names.length}`;

  const toggle = (value: string) => onChange(set.has(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  return (
    <div ref={ref} className={cn("relative min-w-0", className)}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-11 w-full min-w-[128px] items-center justify-between gap-2 rounded-lg border bg-white px-3 text-left text-sm hover:border-neutral-400",
          all ? "border-neutral-300" : "border-neutral-900",
        )}
      >
        <span className="min-w-0">
          <span className="block text-[10px] font-semibold uppercase leading-tight tracking-wide text-neutral-400">{label}</span>
          <span className="block max-w-[170px] truncate font-medium leading-tight text-neutral-900">{summary}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {!all && <span className="rounded-full bg-neutral-900 px-1.5 text-[11px] font-medium leading-5 text-white">{selected.length}</span>}
          <span aria-hidden className={cn("text-neutral-400 transition-transform", open && "rotate-180")}>⌄</span>
        </span>
      </button>
      {open && (
        <div
          id={id}
          className={cn(
            "absolute z-40 mt-1 w-[min(300px,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white p-2 shadow-xl",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {options.length >= searchFrom && (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск…"
              aria-label={`Поиск: ${label}`}
              className="mb-1 h-9 w-full rounded-md border border-neutral-300 px-2 text-sm outline-none focus:border-neutral-500"
            />
          )}
          <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium hover:bg-neutral-50">
            <input type="checkbox" checked={all} onChange={() => onChange([])} className="size-4 accent-neutral-900" />
            <span className="min-w-0 flex-1 truncate">{allLabel}</span>
            <span className="text-xs font-normal text-neutral-400">{options.length}</span>
          </label>
          <div className="max-h-64 overflow-auto border-t border-neutral-100 pt-1">
            {shown.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-neutral-50">
                <input type="checkbox" checked={set.has(o.value)} onChange={() => toggle(o.value)} className="size-4 accent-neutral-900" />
                <span className={cn("min-w-0 flex-1 truncate", o.count === 0 && "text-neutral-400")} title={o.label}>{o.label}</span>
                {o.count != null && <span className="text-xs tabular-nums text-neutral-400">{o.count}</span>}
              </label>
            ))}
            {shown.length === 0 && <div className="px-2 py-3 text-sm text-neutral-400">Ничего не найдено</div>}
          </div>
        </div>
      )}
    </div>
  );
}
