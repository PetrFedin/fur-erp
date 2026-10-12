"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { NONE, type FilterOption } from "@/lib/filters";
import { MultiSelectFilter } from "./multi-select-filter";

/** state — параметр вида/расчёта (группировка, статус, наценка…): меняется так же сразу, но не считается фильтром — без чипа, не входит в «применены: N» и не стирается «Сбросить всё». */
type Common = {
  name: string;
  label: string;
  aliases?: string[];
  className?: string;
  state?: boolean;
  /** Второстепенный фильтр: прячется под «Ещё фильтры» (раскрыт сам, если в нём уже есть выбор). */
  more?: boolean;
};
export type MultiControl = Common & {
  type: "multi";
  options: FilterOption[];
  /** Один пункт вместо нескольких (как select). */
  single?: boolean;
  /** Пункт «Без …» (значение none). */
  noneLabel?: string;
  allLabel?: string;
  hint?: string;
};
export type TextControl = Common & { type: "text"; placeholder?: string; inputMode?: "text" | "decimal" | "numeric"; datalist?: string[] };
export type DateControl = Common & { type: "date" };
export type BarControl = MultiControl | TextControl | DateControl;

const TEXT_DELAY_MS = 400;
const MULTI_DELAY_MS = 120;

const namesOf = (c: Common) => [c.name, ...(c.aliases ?? [])];
const ruDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join(".") : iso);

/**
 * Единая панель фильтров страницы: одна строка (на узком экране переносится и сворачивается в «Фильтры (N)»),
 * чипы активных фильтров, «Сбросить всё». Каждый выбор сразу меняет адрес (router.replace, остальные параметры
 * — tab, view, sort… — сохраняются, page и limit сбрасываются) и перерисовывает серверную страницу;
 * текстовый поиск — с задержкой ≈0,4 с. Без JS работает как GET-форма (кнопка «Применить» видна только без JS).
 */
export function FilterBar({
  title = "Фильтры",
  controls,
  children,
  resetExtra = [],
  dropOnChange = [],
  footer,
  className,
  oneRow,
  hideChips,
}: {
  title?: string;
  controls: BarControl[];
  /** Не показывать чипы выбранных значений (выбор и так виден в самих полях); остаётся только «Сбросить всё». */
  hideChips?: boolean;
  /** Фильтры сеткой с минимальной шириной поля 8,25 rem: на широком экране — одна строка, на узком — аккуратный перенос, поля не накладываются. */
  oneRow?: boolean;
  /** Дополнительные элементы в той же строке (например, переключатель «С остатком»). */
  children?: ReactNode;
  /** Ещё параметры, которые стирает «Сбросить всё» (если ими управляет children). */
  resetExtra?: string[];
  /** Одноразовые параметры (сообщение после действия), которые любое изменение фильтра убирает из адреса. */
  dropOnChange?: string[];
  /** Блок под чипами внутри панели (например, быстрые ссылки на партии). */
  footer?: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const fromUrl = useCallback(() => {
    const out: Record<string, string[]> = {};
    for (const c of controls) {
      const all = namesOf(c).flatMap((n) => sp.getAll(n)).map((v) => v.trim()).filter(Boolean);
      out[c.name] = c.type === "multi" ? Array.from(new Set(all)) : all.slice(0, 1);
    }
    return out;
  }, [controls, sp]);

  const [vals, setVals] = useState<Record<string, string[]>>(fromUrl);
  const spKey = sp.toString();
  const target = useRef<{ key: string; at: number } | null>(null);

  // Адрес изменился (переход, назад/вперёд, ссылка): подтягиваем значения. Свой ещё не завершённый переход не затираем.
  useEffect(() => {
    const t = target.current;
    if (t && t.key !== spKey && Date.now() - t.at < 8000) return;
    target.current = null;
    setVals(fromUrl());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spKey]);

  const hrefFor = useCallback(
    (next: Record<string, string[]>, clearExtra = false) => {
      const p = new URLSearchParams(sp.toString());
      const own = new Set<string>(["page", "limit"]);
      for (const c of controls) for (const n of namesOf(c)) own.add(n);
      for (const n of dropOnChange) own.add(n);
      if (clearExtra) for (const n of resetExtra) own.add(n);
      for (const n of own) p.delete(n);
      for (const c of controls) for (const v of next[c.name] ?? []) if (v) p.append(c.name, v);
      const qs = p.toString();
      return `${pathname}${qs ? `?${qs}` : ""}${typeof window === "undefined" ? "" : window.location.hash}`;
    },
    [controls, pathname, resetExtra, dropOnChange, sp],
  );

  const go = useCallback(
    (next: Record<string, string[]>, clearExtra = false) => {
      const href = hrefFor(next, clearExtra);
      const key = href.split("#")[0].split("?")[1] ?? "";
      target.current = { key, at: Date.now() };
      startTransition(() => router.replace(href, { scroll: false }));
    },
    [hrefFor, router],
  );

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(vals);
  const schedule = (next: Record<string, string[]>, delay: number) => {
    latest.current = next;
    setVals(next);
    if (timer.current) clearTimeout(timer.current);
    if (delay <= 0) go(next);
    else timer.current = setTimeout(() => go(latest.current), delay);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const setCtl = (name: string, v: string[], delay: number) => schedule({ ...latest.current, [name]: v }, delay);
  useEffect(() => { latest.current = vals; }, [vals]);

  // Индикатор загрузки: затемняем всё, что идёт после панели (см. globals.css).
  useEffect(() => {
    const el = document.documentElement;
    if (pending) el.dataset.filtering = "1";
    else delete el.dataset.filtering;
    return () => { delete el.dataset.filtering; };
  }, [pending]);

  // Параметры вне панели (tab, view, sort…) — скрытыми полями: без JS форма их не потеряет.
  const ownNames = new Set<string>(["page", "limit"]);
  for (const c of controls) for (const n of namesOf(c)) ownNames.add(n);
  const hidden = Array.from(sp.entries()).filter(([k]) => !ownNames.has(k) && !resetExtra.includes(k) && !dropOnChange.includes(k));

  return (
    <BarView
      title={title}
      controls={controls}
      vals={vals}
      setCtl={setCtl}
      flush={() => {
        if (timer.current) clearTimeout(timer.current);
        go(latest.current);
      }}
      reset={() => {
        if (timer.current) clearTimeout(timer.current);
        const empty = Object.fromEntries(controls.map((c) => [c.name, c.state ? (latest.current[c.name] ?? []) : ([] as string[])]));
        latest.current = empty;
        setVals(empty);
        go(empty, true);
      }}
      pending={pending}
      hidden={hidden}
      action={pathname}
      footer={footer}
      className={className}
      oneRow={oneRow}
      hideChips={hideChips}
    >
      {children}
    </BarView>
  );
}

/**
 * Та же панель для фильтров, которые считаются на клиенте (таблица «Мех / Подкладка»: лоты уже загружены, варианты
 * каскадные). Вид и поведение те же — выпадающие списки с галочками, чипы, «Сбросить всё», мгновенное применение;
 * хранение значений (в том числе запись в адрес) — на стороне вызывающего.
 */
export function LocalFilterBar({
  title = "Фильтры",
  controls,
  values,
  onChange,
  onReset,
  footer,
  className,
  oneRow,
  hideChips,
}: {
  title?: string;
  oneRow?: boolean;
  hideChips?: boolean;
  controls: BarControl[];
  values: Record<string, string[]>;
  onChange: (name: string, next: string[]) => void;
  onReset: () => void;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <BarView
      title={title}
      controls={controls}
      vals={values}
      setCtl={(name, v) => onChange(name, v)}
      flush={() => {}}
      reset={onReset}
      pending={false}
      hidden={[]}
      footer={footer}
      className={className}
      oneRow={oneRow}
      hideChips={hideChips}
    />
  );
}

/** Фильтр без выбора: список из одного значения (или пустой) — ничего не сужает, поэтому не показывается. Переключатели (single) и режимы вида (state) не трогаем. */
const isPointless = (c: BarControl, vals: Record<string, string[]>) =>
  c.type === "multi" && !c.single && !c.state && c.options.length + (c.noneLabel ? 1 : 0) <= 1 && (vals[c.name] ?? []).length === 0;

function BarView({
  title,
  controls: allControls,
  vals,
  setCtl,
  flush,
  reset,
  pending,
  hidden,
  action,
  footer,
  className,
  oneRow,
  hideChips,
  children,
}: {
  oneRow?: boolean;
  hideChips?: boolean;
  title: string;
  controls: BarControl[];
  vals: Record<string, string[]>;
  setCtl: (name: string, next: string[], delay: number) => void;
  flush: () => void;
  reset: () => void;
  pending: boolean;
  hidden: Array<[string, string]>;
  action?: string;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  // Поле, один раз показанное, остаётся на месте: после выбора соседнего фильтра в его списке может остаться один вариант,
  // но сетка от этого пересобираться не должна.
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set(allControls.filter((c) => !isPointless(c, vals)).map((c) => c.name)));
  const controls = useMemo(() => allControls.filter((c) => !isPointless(c, vals) || seen.has(c.name)), [allControls, vals, seen]);
  const fresh = allControls.filter((c) => !isPointless(c, vals) && !seen.has(c.name)).map((c) => c.name);
  if (fresh.length) setSeen(new Set([...seen, ...fresh]));
  const labelOf = (c: BarControl, v: string) => {
    if (c.type === "date") return ruDate(v);
    if (c.type === "text") return v;
    if (v === NONE) return c.noneLabel ?? "Без значения";
    return c.options.find((o) => o.value === v)?.label ?? v;
  };
  const chips = useMemo(
    () => controls.filter((c) => !c.state).flatMap((c) => (vals[c.name] ?? []).map((v) => ({ c, v }))),
    [controls, vals],
  );
  const count = chips.length;

  const field = "ui-field h-11 rounded-lg border border-neutral-300 bg-white px-3 text-xs font-normal text-neutral-800 placeholder:text-neutral-500 focus-visible:outline-none";

  const moreControls = controls.filter((c) => c.more);
  const mainControls = controls.filter((c) => !c.more);
  const moreCount = moreControls.filter((c) => !c.state).reduce((n, c) => n + (vals[c.name] ?? []).length, 0);
  // Блок «Ещё фильтры» раскрыт сразу, если в нём уже есть выбор; дальше его открывает и закрывает только кнопка (выбор значений блок не трогает).
  const [moreOpen, setMoreOpen] = useState(moreCount > 0);
  const moreActive = moreOpen;
  const gridCls = cn(oneRow ? "grid grid-cols-[repeat(auto-fit,minmax(8.25rem,1fr))] items-end gap-2" : "flex flex-wrap items-end gap-2");
  const renderControl = (c: BarControl) => {
          if (c.type === "multi") {
            return (
              <MultiSelectFilter
                key={c.name}
                name={c.name}
                label={c.label}
                options={c.options}
                value={vals[c.name] ?? []}
                onChange={(v) => setCtl(c.name, v, MULTI_DELAY_MS)}
                single={c.single}
                noneLabel={c.noneLabel}
                allLabel={c.allLabel}
                title={c.hint}
                className={c.className}
              />
            );
          }
          const value = vals[c.name]?.[0] ?? "";
          return (
            <label key={c.name} className={cn("relative flex min-w-0 flex-col max-sm:w-full", c.type === "text" ? "sm:flex-[2] sm:basis-60" : "sm:flex-1 sm:basis-40", c.className)}>
              <span className="pointer-events-none absolute left-3 top-1.5 max-w-[calc(100%-1.5rem)] truncate text-[10px] font-semibold uppercase leading-none tracking-[0.02em] text-neutral-600">{c.label}</span>
              <input
                type={c.type === "date" ? "date" : "search"}
                inputMode={c.type === "text" ? c.inputMode : undefined}
                list={c.type === "text" && c.datalist ? `${c.name}-list` : undefined}
                name={c.name}
                value={value}
                placeholder={c.type === "text" ? c.placeholder : undefined}
                aria-label={c.label}
                autoComplete="off"
                onChange={(e) => setCtl(c.name, e.target.value ? [e.target.value] : [], c.type === "date" ? 0 : TEXT_DELAY_MS)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    flush();
                  }
                }}
                data-active={value ? "" : undefined}
                className={cn(field, "pt-4", "w-full")}
              />
              {c.type === "text" && c.datalist && (
                <datalist id={`${c.name}-list`}>
                  {c.datalist.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              )}
            </label>
          );
  };

  return (
    <section data-filter-bar data-comment-anchor="filters" data-comment-label="Панель фильтров" aria-busy={pending} className={cn("rounded-xl border border-neutral-200 bg-neutral-50/70 p-3", className)}>
      {/* Шапка постоянной высоты: счётчик, индикатор обновления и «Сбросить всё» занимают место всегда (прячутся через invisible), поэтому выбор значений ничего не двигает. */}
      <div className="mb-2 flex min-h-6 items-center gap-2">
        <div className="min-w-0 truncate text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">{title}</div>
        <span className={cn("shrink-0 whitespace-nowrap rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-medium text-white max-sm:hidden", count === 0 && "invisible")} aria-hidden={count === 0}>
          применены: {count || 0}
        </span>
        <span role="status" className={cn("flex shrink-0 items-center gap-1 text-xs text-neutral-500", !pending && "invisible")}>
          <span aria-hidden className="size-3 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
          <span className="max-sm:hidden">Обновляю…</span>
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={count === 0}
            tabIndex={count === 0 ? -1 : undefined}
            aria-hidden={count === 0}
            className={cn("whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium text-blue-700 hover:underline", count === 0 && "invisible")}
          >
            Сбросить всё
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            className="whitespace-nowrap rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 sm:hidden"
          >
            Фильтры{count > 0 ? ` (${count})` : ""} {mobileOpen ? "▴" : "▾"}
          </button>
        </div>
      </div>
      <form method="get" action={action} onSubmit={(e) => e.preventDefault()} className={cn("flex flex-col gap-2", !mobileOpen && "max-sm:hidden")}>
        <div className={gridCls}>
          {hidden.map(([k, v], i) => (
            <input key={`${k}-${i}`} type="hidden" name={k} value={v} />
          ))}
          {mainControls.map(renderControl)}
          {moreControls.length > 0 && (
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreActive}
              className="h-11 min-w-0 truncate rounded-lg border border-dashed border-neutral-300 bg-white px-3 text-sm text-neutral-600 hover:border-neutral-500 max-sm:w-full sm:flex-1 sm:basis-40"
            >
              Ещё фильтры{moreCount > 0 ? ` (${moreCount})` : ""} {moreActive ? "▴" : "▾"}
            </button>
          )}
          {children ? <Fragment key="extra">{children}</Fragment> : null}
        </div>
        {moreActive && moreControls.length > 0 && <div className={gridCls}>{moreControls.map(renderControl)}</div>}
        <noscript>
          <button type="submit" className="h-11 rounded-lg border border-neutral-300 bg-white px-4 text-sm font-medium">Применить</button>
        </noscript>
      </form>
      {/* Чипы (если страница их просит) — в слоте постоянной высоты, в одну строку с прокруткой: панель от выбора не растёт. */}
      {!hideChips && (
        <div className="mt-2 flex h-8 flex-nowrap items-center gap-1.5 overflow-x-auto overflow-y-hidden" aria-label="Активные фильтры">
          {chips.length === 0 && <span className="whitespace-nowrap text-xs text-neutral-500">Активных фильтров нет</span>}
          {chips.map(({ c, v }) => (
            <button
              key={`${c.name}:${v}`}
              type="button"
              onClick={() => setCtl(c.name, (vals[c.name] ?? []).filter((x) => x !== v), 0)}
              title="Убрать этот фильтр"
              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-neutral-300 bg-white py-1 pl-2.5 pr-2 text-xs text-neutral-800 hover:border-neutral-500"
            >
              <span className="text-neutral-500">{c.label}:</span>
              <span className="max-w-[220px] truncate font-normal">{labelOf(c, v)}</span>
              <span aria-hidden className="text-neutral-500">×</span>
              <span className="sr-only">убрать</span>
            </button>
          ))}
        </div>
      )}
      {/* Блок передаётся серверной страницей (элемент с владельцем DashboardPage): без собственного key в списке детей <section> React 19 ругается «Each child in a list should have a unique key». */}
      {footer ? <div key="footer">{footer}</div> : null}
    </section>
  );
}
