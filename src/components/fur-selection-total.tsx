"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatMoney, formatQty, cn } from "@/lib/utils";
import { useCommission4Display } from "@/lib/commission4-display";
import { useVatDisplay } from "@/lib/vat-display";
import { InfoHint } from "@/components/info-hint";
import { LocalFilterBar, type BarControl } from "@/components/filters/filter-bar";
import {
  FILTER_KEYS, NO_AUCTION, allParamNames, buildFurTable, emptyFilters, filterOptions, filtersToEntries, figures, flowOf, hasFilters, parseFilters, rowsBy,
  type FilterKey, type FlowFigures, type FurFilters, type FurKind, type FurLot, type TableRow,
} from "@/lib/fur-table";

type ViewMode = "qty" | "money" | "all";

const FILTER_LABELS: Record<FilterKey, { kind: Record<FurKind, string>; all: string }> = {
  item: { kind: { fur: "Мех", lining: "Ткань" }, all: "Все" },
  year: { kind: { fur: "Год закупки", lining: "Год закупки" }, all: "Все годы" },
  color: { kind: { fur: "Цвет", lining: "Цвет" }, all: "Все цвета" },
  size: { kind: { fur: "Размер", lining: "Размер" }, all: "Все размеры" },
  attr: { kind: { fur: "Признак меха", lining: "Признак" }, all: "Все признаки" },
  auction: { kind: { fur: "Партия закупки (аукцион)", lining: "Партия закупки (аукцион)" }, all: "Все партии" },
  rest: { kind: { fur: "Остаток", lining: "Остаток" }, all: "Любой" },
};

const Q = (n: number | null) => (n == null ? "—" : formatQty(n));
const R = (n: number | null) => (n == null ? "—" : formatMoney(n));

/**
 * Таблица «куплено → использовано → остаток» по меху или подкладке (расчёт — src/lib/fur-table.ts, одна функция на
 * /lots, Сводку и analytics/raw). Фильтры — выпадающие списки с галочками, применяются сразу и хранятся в URL.
 * Клик по названию или стрелке раскрывает строку до партий (аукционов) и лотов; чекбокс слева выбирает строку для тотала.
 */
export function FurSelectionTotal({
  lots,
  kind = "fur",
  globalYear = "all",
  initialQuery = {},
}: {
  lots: FurLot[];
  kind?: FurKind;
  /** Общий год из шапки (cookie yearFilter): лоты уже отфильтрованы им; локальный «Год закупки» сужает внутри. */
  globalYear?: string;
  initialQuery?: Record<string, string | string[] | undefined>;
}) {
  const router = useRouter();
  const unit = kind === "lining" ? "м" : "шт.";
  const unitWord = kind === "lining" ? "метр" : "шкуру";
  const { mode: c4 } = useCommission4Display();
  const { mode: vat } = useVatDisplay();
  const mode = useMemo(() => ({ vat, c4 }), [vat, c4]);

  const [filters, setFilters] = useState<FurFilters>(() => parseFilters(initialQuery, kind));
  // Поиск по № лота, материалу, цвету, сорту — тоже здесь (лоты загружены целиком): параметр q, старое dq читается.
  const [q, setQ] = useState(() => {
    const v = initialQuery.q ?? initialQuery.dq;
    return (Array.isArray(v) ? v[0] : v ?? "").trim().slice(0, 100);
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [onlySelected, setOnlySelected] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState<ViewMode>("all");

  // Состояние фильтров — в адресной строке (повтор параметров: fur=a&fur=b), без перезагрузки страницы.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      const url = new URL(window.location.href);
      for (const n of allParamNames(kind)) url.searchParams.delete(n);
      for (const n of ["q", "dq"]) url.searchParams.delete(n);
      for (const [k, v] of filtersToEntries(filters, kind)) url.searchParams.append(k, v);
      if (q.trim()) url.searchParams.set("q", q.trim());
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch {
      /* адресная строка недоступна — фильтры работают и без неё */
    }
  }, [filters, kind, q]);

  const needle = q.trim().toLowerCase();
  const baseLots = useMemo(
    () => (needle ? lots.filter((l) => [l.lotNumber, l.materialName, l.item, l.color, l.size, l.grade, ...l.attrs].some((x) => (x ?? "").toLowerCase().includes(needle))) : lots),
    [lots, needle],
  );
  const table = useMemo(() => buildFurTable({ lots: baseLots, filters, selected, onlySelected, mode }), [baseLots, filters, selected, onlySelected, mode]);
  const options = useMemo(
    () => Object.fromEntries(FILTER_KEYS.map((k) => [k, filterOptions(baseLots, filters, k)])) as Record<FilterKey, ReturnType<typeof filterOptions>>,
    [baseLots, filters],
  );
  const shownKeys: FilterKey[] = kind === "lining" ? ["auction", "item", "year", "color", "rest"] : ["auction", "item", "year", "color", "size", "attr", "rest"];

  const setFilter = (k: FilterKey, v: string[]) => setFilters((f) => ({ ...f, [k]: v }));
  const toggleSel = (key: string) => setSelected((s) => (s.includes(key) ? s.filter((x) => x !== key) : [...s, key]));
  const toggleExp = (key: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const allVisible = table.allRows.map((r) => r.key);
  const selectedHere = table.selectedKeys.length;
  const allChecked = allVisible.length > 0 && selectedHere === allVisible.length;
  const headRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headRef.current) headRef.current.indeterminate = selectedHere > 0 && !allChecked;
  }, [selectedHere, allChecked]);

  const t = table.totalFigures;
  const usdNote = kind === "fur" && t.usdAvg != null ? `$${t.usdAvg.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}` : null;
  const vatWord = vat === "excl" ? "без НДС" : "с НДС";
  const c4Word = c4 === "on" ? "с 4%" : "без 4%";

  const showQty = view !== "money";
  const showMoney = view !== "qty";
  const avgHint = (what: string, extra?: string) => (
    <InfoHint label={`Как считается средняя цена ${what}`} align="right">
      <p><b>Средневзвешенная цена {what}</b></p>
      <p className="mt-1">= Σ ₽ {what === "закупки" ? "куплено" : what === "использования" ? "использовано" : "остатка"} ÷ Σ {unit === "м" ? "метров" : "шкур"} (отношение сумм, а не среднее цен лотов).</p>
      <p className="mt-1">Сейчас: {vatWord}{what === "использования" ? `, ${c4Word}` : ""}. {extra}</p>
    </InfoHint>
  );

  // Колонки по показателям: Куплено (шт., ₽, ср. цена) → Использовано (…) → Остаток (…); режим шт./₽/Все прячет лишнее.
  const GROUPS = [
    { key: "recv", title: "Куплено", what: "закупки", extra: "4% к закупке не применяется.", qty: (f: FlowFigures) => f.recvQty, val: (f: FlowFigures) => f.recvValue, avg: (f: FlowFigures) => f.recvAvg },
    { key: "used", title: "Использовано", what: "использования", extra: "4% начисляется только на строки списания, где оно разрешено.", qty: (f: FlowFigures) => f.usedQty, val: (f: FlowFigures) => f.usedValue, avg: (f: FlowFigures) => f.usedAvg },
    { key: "rem", title: "Остаток", what: "остатка", extra: "4% к остатку не применяется (оно начисляется при списании в ТЗ).", qty: (f: FlowFigures) => f.remQty, val: (f: FlowFigures) => f.remValue, avg: (f: FlowFigures) => f.remAvg },
  ] as const;
  const perGroup = (showQty ? 1 : 0) + (showMoney ? 2 : 0);
  const groupHead = (
    <tr>
      <th rowSpan={2} className="sticky left-0 z-10 bg-neutral-50 px-3 py-2 text-left align-bottom font-medium">
        <label className="flex items-center gap-2">
          <input ref={headRef} type="checkbox" checked={allChecked} onChange={() => setSelected(allChecked ? [] : allVisible)} aria-label="Выбрать все строки" className="size-4 accent-neutral-900" />
          <span>{kind === "lining" ? "Подкладка" : "Мех"}</span>
        </label>
      </th>
      {GROUPS.map((g) => (
        <th key={g.key} colSpan={perGroup} className="border-l border-neutral-200 px-3 pb-1 pt-2 text-right text-[11px] font-semibold uppercase tracking-wide text-neutral-600">{g.title}</th>
      ))}
    </tr>
  );
  const colsHead = (
    <>
      {GROUPS.map((g) => (
        <Fragment key={g.key}>
          {showQty && <Th first>{g.title}, {unit}</Th>}
          {showMoney && <Th first={!showQty}>{g.title}, ₽</Th>}
          {showMoney && <Th>Ср. цена, ₽/{unit}{avgHint(g.what, g.extra)}</Th>}
        </Fragment>
      ))}
    </>
  );
  const cells = (f: FlowFigures, o: { strong?: boolean; altUsed?: boolean; small?: boolean } = {}) => (
    <>
      {GROUPS.map((g) => (
        <Fragment key={g.key}>
          {showQty && <Num first strong={o.strong} small={o.small}>{Q(g.qty(f))}</Num>}
          {showMoney && (
            g.key === "used" ? (
              <Num first={!showQty} strong={o.strong} small={o.small} title={`${c4 === "on" ? "без 4%" : "с 4%"}: ${formatMoney(f.usedValueOther)}`}>
                <div>{R(f.usedValue)}</div>
                
              </Num>
            ) : (
              <Num first={!showQty} strong={o.strong} small={o.small}>{R(g.val(f))}</Num>
            )
          )}
          {showMoney && <Num strong={o.strong} small={o.small} muted>{R(g.avg(f))}</Num>}
        </Fragment>
      ))}
    </>
  );
  const nCols = 1 + 3 * perGroup;
  // Ширины колонок рассчитаны под Inter (он шире Arial): сумма до 9 знаков + ₽ влезает без слипания с соседней колонкой.
  const widthClass = view === "qty" ? "min-w-[520px]" : view === "money" ? "min-w-[990px]" : "min-w-[1290px]";

  // «Лоты без ТЗ» (не использованы в производстве) — отдельным блоком в конце таблицы; основные строки — лоты со списаниями в ТЗ.
  // Σ «с ТЗ» + Σ «без ТЗ» = «Итого» (блок без ТЗ считается по тем же строкам, что и «Итого»: выбранным, а без выбора — показанным).
  const hasTz = (l: FurLot) => l.usages.length > 0 || l.used > 0;
  const totalRowKeys = new Set(table.selectedKeys.length > 0 ? table.selectedKeys : table.rows.map((r) => r.key));
  const noTzRows = useMemo(
    () => rowsBy(table.rows.filter((r) => totalRowKeys.has(r.key)).flatMap((r) => r.lots).filter((l) => !hasTz(l)), mode, (l) => l.item),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table, mode],
  );
  const mainRows = useMemo(
    () => table.rows.flatMap((r) => {
      const withTz = r.lots.filter(hasTz);
      if (withTz.length === 0) return [];
      const flow = flowOf(withTz);
      return [{ ...r, lots: withTz, flow, figures: figures(flow, mode) } as TableRow];
    }),
    [table, mode],
  );
  const mainTotal = useMemo(
    () => figures(flowOf(mainRows.filter((r) => totalRowKeys.has(r.key)).flatMap((r) => r.lots)), mode),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mainRows, table, mode],
  );
  const noTzLots = noTzRows.reduce((n, r) => n + r.lots.length, 0);
  const noTzTotal = useMemo(() => figures(flowOf(noTzRows.flatMap((r) => r.lots)), mode), [noTzRows, mode]);
  const noTzOpen = expanded.has("z:block");

  const renderRow = (row: TableRow, pfx = "g:") => {
    const isSel = table.selectedKeys.includes(row.key);
    const gk = pfx + row.key;
    const open = expanded.has(gk);
    const auctions = open ? rowsBy(row.lots, mode, (l) => l.auction, (l) => l.auctionLabel) : [];
    return (
      <Fragment key={row.key}>
        <tr
          data-row={pfx === "g:" ? row.key : pfx + row.key}
          onClick={() => toggleExp(gk)}
          className={cn("cursor-pointer border-t border-neutral-100 hover:bg-neutral-50", isSel && "bg-amber-50/60 hover:bg-amber-50")}
        >
          <td className={cn("sticky left-0 z-10 px-3 py-2", isSel ? "bg-amber-50" : "bg-white")}>
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={isSel}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleSel(row.key)}
                aria-label={`Выбрать для тотала: ${row.label}`}
                className="mt-1 size-4 shrink-0 accent-neutral-900"
              />
              <button type="button" aria-expanded={open} className="min-w-0 text-left" onClick={(e) => { e.stopPropagation(); toggleExp(gk); }}>
                <span aria-hidden className={cn("mr-1 inline-block text-neutral-500 transition-transform", open && "rotate-90")}>›</span>
                <span className="font-medium">{row.label}</span>
                <span className="ml-1.5 text-xs text-neutral-500">{row.lots.length} лот.</span>
              </button>
            </div>
          </td>
          {cells(row.figures)}
        </tr>
        {open && auctions.map((a) => {
          const ak = `a:${pfx}${row.key}:${a.key}`;
          const aOpen = expanded.has(ak);
          return (
            <Fragment key={ak}>
              <tr data-sub="auction" onClick={() => toggleExp(ak)} className="cursor-pointer border-t border-neutral-100 bg-neutral-50/80 text-[13px] hover:bg-neutral-100/70">
                <td className="sticky left-0 z-10 bg-neutral-50 py-1.5 pl-9 pr-3">
                  <button type="button" aria-expanded={aOpen} className="text-left" onClick={(e) => { e.stopPropagation(); toggleExp(ak); }}>
                    <span aria-hidden className={cn("mr-1 inline-block text-neutral-500 transition-transform", aOpen && "rotate-90")}>›</span>
                    {a.label}
                    <span className="ml-1.5 text-xs text-neutral-500">{a.lots.length} лот.</span>
                  </button>
                </td>
                {cells(a.figures, { small: true })}
              </tr>
              {aOpen && a.lots.map((l) => (
                <tr key={l.id} data-sub="lot" className="border-t border-neutral-100 bg-white text-[13px]">
                  <td className="sticky left-0 z-10 bg-white py-1.5 pl-14 pr-3 align-top">
                    <div className="font-medium">№ {l.lotNumber}</div>
                    <div className="text-xs text-neutral-500">
                      {[l.materialName !== row.label ? l.materialName : null, l.color !== "Не указан" ? l.color : null, l.size !== "Не указан" ? l.size : null, String(l.year)].filter(Boolean).join(" · ")}
                    </div>
                    {l.attrs.length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-1" data-lot-attrs>
                        {l.attrs.map((a) => (
                          <span key={a} title="Признак меха" className="rounded-full bg-amber-50 px-1.5 text-[11px] leading-4 text-amber-800 ring-1 ring-amber-200">{a}</span>
                        ))}
                      </div>
                    )}
                    {(l.purchaseId || l.usages.length > 0) && (
                      <div className="mt-0.5 text-xs text-neutral-500">
                        {l.purchaseId && (
                          <Link href={`/purchases/${l.purchaseId}`} className="text-blue-700 hover:underline" onClick={(e) => e.stopPropagation()}>
                            {l.supplier ? `${l.supplier} (${l.purchaseNumber})` : l.purchaseNumber}
                          </Link>
                        )}
                        {l.usages.length > 0 && (
                          <span>
                            {l.purchaseId ? " · " : ""}ТЗ:{" "}
                            {l.usages.slice(0, 4).map((u, i) => (
                              <Fragment key={u.orderId}>
                                {i > 0 && ", "}
                                <Link href={`/production/${u.orderId}`} className="text-blue-700 hover:underline" onClick={(e) => e.stopPropagation()}>{u.number}</Link>
                                {` (${formatQty(u.qty)})`}
                              </Fragment>
                            ))}
                            {l.usages.length > 4 && ` +${l.usages.length - 4}`}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  {cells(figures(flowOf([l]), mode), { small: true })}
                </tr>
              ))}
            </Fragment>
          );
        })}
      </Fragment>
    );
  };

  // Фильтры таблицы — та же панель, что на остальных страницах (мгновенное применение, чипы, «Сбросить всё»);
  // лоты загружены целиком, варианты каскадные, поэтому значения считаются здесь, а адрес обновляется без перезагрузки.
  const controls: BarControl[] = [
    ...shownKeys.map((k): BarControl => ({
      type: "multi",
      name: k,
      label: FILTER_LABELS[k].kind[kind],
      allLabel: FILTER_LABELS[k].all,
      options: options[k],
      ...(k === "attr" ? { hint: "Седина (SIL), дикий / клеточный, тонированный… — справочник «Признаки меха» в Настройках" } : {}),
      ...(k === "auction" && kind === "fur" ? { hint: "Одна партия — откроются её счета и лоты (режим «Аукцион»); несколько — таблица сузится по ним" } : {}),
    })),
    { type: "text", name: "q", label: "Поиск", placeholder: kind === "lining" ? "№ лота, ткань, цвет, сорт" : "№ лота, материал, цвет, сорт" },
  ];

  return (
    <div className="space-y-3">
      <LocalFilterBar
        title={kind === "lining" ? "Фильтры подкладки" : "Фильтры меха"}
        controls={controls}
        values={{ ...filters, q: q ? [q] : [] }}
        onChange={(name, v) => {
          // Выбрана ровно одна партия закупки — открывается режим «Аукцион» (счета и лоты этой партии): /lots?auction=…
          if (name === "auction" && kind === "fur" && v.length === 1 && v[0] !== NO_AUCTION) {
            const p = new URLSearchParams();
            p.set("auction", v[0]);
            if (q.trim()) p.set("q", q.trim());
            router.push(`/lots?${p.toString()}`);
            return;
          }
          if (name === "q") setQ(v[0] ?? "");
          else setFilter(name as FilterKey, v);
        }}
        onReset={() => { setFilters(emptyFilters()); setQ(""); }}
        footer={
          <>
            <p className="mt-2 flex items-center gap-1 text-[11px] leading-4 text-neutral-500">
              Число у пункта — лотов
              <InfoHint label="О фильтрах" align="left">
                {options.year.length > 1 || filters.year.length > 0
                  ? `«Год закупки» — дополнительный фильтр внутри общего года из шапки (сейчас: ${globalYear === "all" ? "все годы" : `${globalYear} год`}). Число у пункта — лотов.`
                  : "Число у пункта — лотов. Фильтры, у которых в данных одно значение, не показываются."}
              </InfoHint>
            </p>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-xs text-neutral-500">
        {selectedHere > 0 && (
          <span>
            Выбрано: <b className="text-neutral-900">{selectedHere}</b> из {allVisible.length}
            <button type="button" onClick={() => { setSelected([]); setOnlySelected(false); }} className="ml-2 underline">снять выбор</button>
          </span>
        )}
        {usdNote && <span className="inline-flex items-center gap-1">Цена в $: <b className="text-neutral-900">{usdNote}</b>/{unit}
          <InfoHint label="Как считается цена в $" align="left">Средняя по {t.usdQty.toLocaleString("ru-RU")} из {t.recvQty.toLocaleString("ru-RU")} шт. — только лоты с ценой в USD: в долларах в расчёте, евро × курс из расчёта, молоток ₽ ÷ курс USD/RUB из расчёта.</InfoHint></span>}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <span className="inline-flex rounded-lg border border-neutral-300 bg-white p-0.5">
            {([["all", "Все"], ["sel", "Только выбранные"]] as const).map(([key, label]) => {
              const active = (key === "sel") === onlySelected;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={key === "sel" && selectedHere === 0}
                  onClick={() => setOnlySelected(key === "sel")}
                  className={cn("rounded-md px-3 py-1.5 disabled:opacity-40", active ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-50")}
                >
                  {label}
                </button>
              );
            })}
          </span>
          <span className="inline-flex rounded-lg border border-neutral-300 bg-white p-0.5">
            {([["qty", `${unit}`], ["money", "₽"], ["all", "Все"]] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setView(key)} className={cn("rounded-md px-3 py-1.5", view === key ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-50")}>{label}</button>
            ))}
          </span>
        </span>
      </div>

      {/* Шапка (обе строки) остаётся на месте при прокрутке: таблица листается внутри рамки, до 75% высоты экрана. */}
      <div className="scroll-hint max-h-[75vh] overflow-auto rounded-xl border border-neutral-200 [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-20">
        <table className={cn("w-full table-fixed text-sm tabular-nums", widthClass)}>
          <colgroup>
            <col className="w-[150px] md:w-[210px]" />
            {[0, 1, 2].map((i) => (
              <Fragment key={i}>
                {showQty && <col style={{ width: 100 }} />}
                {showMoney && <col style={{ width: 152 }} />}
                {showMoney && <col style={{ width: 108 }} />}
              </Fragment>
            ))}
          </colgroup>
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            {groupHead}
            <tr>{colsHead}</tr>
          </thead>
          <tbody>
            <tr data-total className="border-t border-neutral-200 bg-neutral-100/70 text-[15px] font-semibold">
              <td className="sticky left-0 z-10 bg-neutral-100 px-3 py-2.5 text-left font-semibold">
                {table.totalOf === "selected" ? `Итого выбранное (${selectedHere} из ${allVisible.length})` : `Итого (${table.rows.length} ${kind === "lining" ? "ткан." : "вид."})`}
                <div className="text-[11px] font-normal text-neutral-500">{table.total.lots} лот.{hasFilters(filters) || needle ? " · по фильтрам" : ""} · {vatWord}</div>
              </td>
              {cells(t, { strong: true, altUsed: true })}
            </tr>
            {mainRows.map((r) => renderRow(r))}
            {table.rows.length > 0 && (
              <>
                <tr data-block="with-tz" className="border-t-2 border-neutral-300 bg-neutral-50/70 text-[13px] font-medium">
                  <td className="sticky left-0 z-10 bg-neutral-50 px-3 py-2">
                    Лоты с ТЗ<span className="ml-1.5 text-xs font-normal text-neutral-500">{mainTotal.lots} лот.</span>
                  </td>
                  {cells(mainTotal, { small: true })}
                </tr>
                <tr data-block="no-tz" onClick={() => toggleExp("z:block")} className="cursor-pointer border-t border-neutral-200 bg-amber-50/50 text-[13px] font-medium hover:bg-amber-50">
                  <td className="sticky left-0 z-10 bg-amber-50 px-3 py-2">
                    <button type="button" aria-expanded={noTzOpen} className="text-left" onClick={(e) => { e.stopPropagation(); toggleExp("z:block"); }}>
                      <span aria-hidden className={cn("mr-1 inline-block text-neutral-500 transition-transform", noTzOpen && "rotate-90")}>›</span>
                      Лоты без ТЗ — не использованы
                      <span className="ml-1.5 text-xs font-normal text-neutral-500">{noTzLots} лот.</span>
                    </button>
                  </td>
                  {cells(noTzTotal, { small: true })}
                </tr>
                {noTzOpen && noTzRows.map((r) => renderRow(r, "z:"))}
                {noTzOpen && noTzRows.length === 0 && (
                  <tr><td colSpan={nCols} className="px-3 py-3 pl-9 text-xs text-neutral-500">Все лоты использованы в ТЗ</td></tr>
                )}
              </>
            )}
            {table.rows.length === 0 && (
              <tr><td colSpan={nCols} className="px-3 py-6 text-center text-neutral-500">{lots.length === 0 ? "Закупок за выбранный период нет" : "Нет данных по выбранным фильтрам"}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="flex items-center gap-1 px-1 text-[11px] leading-4 text-neutral-500">
        Как читать таблицу
        <InfoHint label="Как читать таблицу" wide>
          {unitWord === "шкуру" ? "Цены — за шкуру, " : "Цены — за метр, "}
          ₽ показаны {vatWord}; «использовано» — {c4Word} (4% — только строки списания в ТЗ, где оно разрешено; в другой базе: переключатель «4% к сырью» в шапке); остаток = куплено − использовано (шт. и ₽ без 4%).
        </InfoHint>
      </p>
    </div>
  );
}

function Th({ children, first }: { children: ReactNode; first?: boolean }) {
  return <th className={cn("px-3 pb-2 pt-1 text-right align-bottom font-medium leading-tight", first && "border-l border-neutral-200")}>{children}</th>;
}

function Num({ children, strong, small, muted, title, first }: { children: ReactNode; strong?: boolean; small?: boolean; muted?: boolean; title?: string; first?: boolean }) {
  return (
    <td title={title} className={cn("px-3 py-2 text-right tabular-nums", first && "border-l border-neutral-100", small && "py-1.5 text-[13px]", strong && "font-semibold", muted && !strong && "text-neutral-500")}>
      {children}
    </td>
  );
}
