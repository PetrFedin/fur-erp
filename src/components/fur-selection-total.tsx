"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatMoney, cn } from "@/lib/utils";
import { useVatDisplay } from "@/lib/vat-display";
import { PinSection } from "@/components/pin-section";
import { LevelSummaryFromFigures, LevelSummaryFromTotals } from "@/components/level-tiles";
import type { LevelTotals } from "@/lib/mart/level-totals";
import { useCommission4Display } from "@/lib/commission4-display";
import { InfoHint } from "@/components/info-hint";
import { TotalLabel } from "@/components/total-label";
import { LocalFilterBar, type BarControl } from "@/components/filters/filter-bar";
import { ALL_TYPES_LABEL, FUR_SRC_KEYS, FUR_SRC_LABEL, SegmentSwitch, TypeDots, useSrcTypeNav, type FurSrc } from "@/components/fur-source-nav";
import { useClientSort } from "@/lib/use-client-sort";
import { sortRows, type SortVal } from "@/lib/table-sort";
import { ScopeEmpty, useFurScope } from "@/components/fur-scope";
import { alignFlowSet } from "@/lib/money-round";
import { alignFurBySource } from "@/lib/fur-src-data";
import { rawRowsFromLots } from "@/lib/raw-rows";
import { FurOrdersTable, type OrderInfo } from "@/components/fur-orders-table";
import type { RawTableRow } from "@/lib/dashboard-data";
import { FILTER_KEYS, NO_AUCTION, mergeFlows, allParamNames, buildFurTable, emptyFilters, filterOptions, filtersToEntries, figures, flowOf, hasFilters, planUsdAvg, parseFilters, rowsBy, type FilterKey, type FlowFigures, type FurFilters, type FurKind, type FurLot, type TableRow } from "@/lib/fur-table";
import { FILTER_LABELS, ISO_DATE, MAIN_FUR, OTHER_FUR, firstOf, inSrc, type Level, type ViewMode } from "./_fur-selection-total/helpers";
import { RowsToolbar } from "./_fur-selection-total/rows-toolbar";
import { makeTableCells } from "./_fur-selection-total/table-cells";
import { makeTreeRows } from "./_fur-selection-total/tree-rows";

/**
 * Таблица «куплено → использовано → остаток» по меху или подкладке (расчёт — src/lib/fur-table.ts, одна функция на
 * /lots, Сводку и analytics/raw). Фильтры — выпадающие списки с галочками, применяются сразу и хранятся в URL.
 * Клик по названию или стрелке раскрывает строку до партий (аукционов) и лотов; чекбокс слева выбирает строку для итога.
 */
export function FurSelectionTotal({
  lots: lotsAll,
  kind = "fur",
  globalYear = "all",
  initialQuery = {},
  widgets,
  raw,
  lockItem,
  summaryOnly,
  variant = "main",
  orderInfo,
  noLotsKinds,
  noLotsInfo,
  martTotals,
}: {
  /** Итоги верхнего уровня из витрины (весь мех или вся подкладка): без фильтров, источника и года полоса итогов читает их, а не считается по лотам. */
  martTotals?: LevelTotals | null;
  /** По виду без лотов: изделия, ТЗ и работа из ТЗ (как на Главной) — показываются в «Использовано» с подписью «по ТЗ», в итоги не входят. */
  noLotsInfo?: Record<string, { units: number; orders: number; work: number }>;
  /** Виды меха без лотов (сырьё подрядчика, «Бобр»): пункт фильтра «лотов нет» и строка «—» в таблице; в суммы не входят. */
  noLotsKinds?: string[];
  /** Сведения о ТЗ (артикул, партия, изделий, статус) для таблицы «Использование по ТЗ» страницы вида меха. */
  orderInfo?: Record<string, OrderInfo>;
  /** Страница вида меха: лоты уже отобраны по одному виду; фильтра «Вид» нет, строки — по аукционам или годам (год → аукцион), внизу «Использование по ТЗ». */
  lockItem?: string;
  /** Общая страница «Сырьё → Мех»: строки раскрываются до аукциона; лоты и ТЗ — на странице аукциона и вида меха. */
  summaryOnly?: boolean;
  /** «years» — отдельная таблица «Динамика по годам» (год → сырьё → аукцион либо год → аукцион → сырьё) под основной: без фильтров, плиток и выбора строк. */
  variant?: "main" | "years";
  /** Ряд виджетов (плитки сырья и оплат): стоит под панелью фильтров и над таблицей. */
  widgets?: ReactNode;
  /**
   * Плитки сырья и оплат, которые пересчитываются по фильтрам таблицы: без фильтров показывается `tiles` (серверные плитки Главной, цифры те же),
   * при любом фильтре/поиске/датах — плитки по отфильтрованным лотам (лоты несут paid/due для оплат). `after` — то, что идёт под плитками (формы подкладки).
   */
  raw?: { tiles: ReactNode; after?: ReactNode; c4: "on" | "off"; fur: { incl: FlowFigures; excl: FlowFigures }; lining: { incl: FlowFigures; excl: FlowFigures }; headerEnd?: ReactNode; rows: RawTableRow[]; /** Плитки оплат Главной (PayTiles bare) для слайда «Вся закупка · Все типы» без фильтров. */ pay?: ReactNode };
  lots: FurLot[];
  kind?: FurKind;
  /** Общий год из шапки (cookie yearFilter): лоты уже отфильтрованы им; локальный «Год закупки» сужает внутри. */
  globalYear?: string;
  initialQuery?: Record<string, string | string[] | undefined>;
}) {
  const router = useRouter();
  // Страница вида меха внутри FurScope: общий переключатель источника («Вся закупка / На аукционах / У поставщика») сужает лоты таблицы и плиток.
  // Раздел «Сырьё» целиком внутри FurScope: источник сужает лоты таблицы, плиток, годов и дерева (подкладка не делится по источнику — см. liningOff).
  const scope = useFurScope();
  const scopeSrc: FurSrc = scope && kind === "fur" ? scope.src : "all";
  // Подкладка закупается у поставщика, а не на аукционе: в режиме «На аукционах» её нет (на экране это объяснено), в остальных режимах — вся подкладка.
  const liningOff = kind === "lining" && scope?.src === "auction";
  const lots = useMemo(() => (scopeSrc === "all" ? lotsAll : lotsAll.filter((l) => inSrc(scopeSrc, l))), [lotsAll, scopeSrc]);
  const unit = kind === "lining" ? "м" : "шт.";
  // «Использовано» следует переключателю шапки: «С 4 %» — с надбавкой (где она начисляется), «Без 4 %» — без неё.
  const { mode: vat } = useVatDisplay();
  const c4 = useCommission4Display().mode;
  const show4 = c4 === "on";
  const mode = useMemo(() => ({ vat, c4 }), [vat, c4]);

  const [filters, setFilters] = useState<FurFilters>(() => parseFilters(initialQuery, kind));
  // Поиск по № лота, материалу, цвету, сорту — тоже здесь (лоты загружены целиком): параметр q, старое dq читается.
  const [q, setQ] = useState(() => {
    const v = initialQuery.q ?? initialQuery.dq;
    return (Array.isArray(v) ? v[0] : v ?? "").trim().slice(0, 100);
  });
  // Дата заказа закупки с / по (yyyy-mm-dd): параметры from, to.
  const [dateFrom, setDateFrom] = useState(() => { const v = firstOf(initialQuery.from).trim(); return ISO_DATE.test(v) ? v : ""; });
  const [dateTo, setDateTo] = useState(() => { const v = firstOf(initialQuery.to).trim(); return ISO_DATE.test(v) ? v : ""; });
  const [selected, setSelected] = useState<string[]>([]);
  const [onlySelected, setOnlySelected] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState<ViewMode>("all");
  // «Строки по»: вид меха (ткань) либо год закупки — год раскрывается в вид → партию → лот → ТЗ.
  const [group, setGroup] = useState<"item" | "year" | "auction" | "lots">(variant === "years" || lockItem ? "year" : "item");
  const [yearOrder, setYearOrder] = useState<"item" | "auction">("item");
  // «Списком лотов»: плоская таблица лотов (те же строки-лоты, что внутри дерева) с сортировкой; поиск и фильтры — общие, над таблицей.
  const [lotSort, setLotSort] = useState<"num" | "recv" | "used" | "rem">("num");
  // Сортировка по клику на заголовок столбца (▲/▼, повторный клик — наоборот): строки каждого уровня; без выбора — прежний порядок.
  const colGet = useMemo(() => {
    const m: Record<string, (r: { figures: FlowFigures; label: string }) => SortVal> = { name: (r) => r.label };
    for (const [k, qty, val, avg, usd] of [
      ["recv", (f: FlowFigures) => f.recvQty, (f: FlowFigures) => f.recvValue, (f: FlowFigures) => f.recvAvg, (f: FlowFigures) => f.usdAvg],
      ["used", (f: FlowFigures) => f.usedQty, (f: FlowFigures) => f.usedValue, (f: FlowFigures) => f.usedAvg, (f: FlowFigures) => f.usdUsedAvg],
      ["rem", (f: FlowFigures) => f.remQty, (f: FlowFigures) => f.remValue, (f: FlowFigures) => f.remAvg, (f: FlowFigures) => f.usdRemAvg],
    ] as const) {
      m[`${k}.qty`] = (r) => qty(r.figures); m[`${k}.val`] = (r) => val(r.figures); m[`${k}.avg`] = (r) => avg(r.figures); m[`${k}.usd`] = (r) => usd(r.figures);
    }
    return m;
  }, []);
  const cs = useClientSort<{ figures: FlowFigures; label: string }>(colGet);

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
      for (const n of ["q", "dq", "from", "to"]) url.searchParams.delete(n);
      for (const [k, v] of filtersToEntries(filters, kind)) url.searchParams.append(k, v);
      if (q.trim()) url.searchParams.set("q", q.trim());
      if (dateFrom) url.searchParams.set("from", dateFrom);
      if (dateTo) url.searchParams.set("to", dateTo);
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch {
      /* адресная строка недоступна — фильтры работают и без неё */
    }
  }, [filters, kind, q, dateFrom, dateTo]);

  const needle = q.trim().toLowerCase();
  const isFiltered = hasFilters(filters) || Boolean(needle) || Boolean(dateFrom || dateTo);
  // Поиск и даты применяются к лотам всех источников (baseLotsAllSrc — для сверки «аукцион + поставщик = вся закупка»), затем сужает источник (baseLots).
  const baseLotsAllSrc = useMemo(() => {
    let list = needle ? lotsAll.filter((l) => [l.lotNumber, l.materialName, l.item, l.color, l.size, l.grade, l.supplier, l.purchaseNumber, ...l.attrs].some((x) => (x ?? "").toLowerCase().includes(needle))) : lotsAll;
    // Дата заказа закупки: строки без даты (заказано без лота, шкуры подрядчика) при заданных датах не показываются.
    if (dateFrom || dateTo) list = list.filter((l) => l.orderDate != null && (!dateFrom || l.orderDate >= dateFrom) && (!dateTo || l.orderDate <= dateTo));
    return list;
  }, [lotsAll, needle, dateFrom, dateTo]);
  const baseLots = useMemo(() => (scopeSrc === "all" ? baseLotsAllSrc : baseLotsAllSrc.filter((l) => inSrc(scopeSrc, l))), [baseLotsAllSrc, scopeSrc]);
  const table = useMemo(() => buildFurTable({ lots: baseLots, filters, selected, onlySelected, mode }), [baseLots, filters, selected, onlySelected, mode]);
  // Те же фильтры по лотам всех источников: слайды типов, доли и сверки «аукцион + поставщик = вся закупка» считаются по ним.
  const tableAllSrc = useMemo(() => (scopeSrc === "all" ? table : buildFurTable({ lots: baseLotsAllSrc, filters, selected: [], onlySelected: false, mode })), [scopeSrc, table, baseLotsAllSrc, filters, mode]);
  // Слайды ряда плиток. Мех — два уровня: источник («Вся закупка | На аукционах | У поставщика») → слайды типов меха внутри него
  // («Все типы» → Лиса → Норка → …, только типы с данными). Ткань — один уровень: «Все ткани» → по тканям. Слайд меняет только плитки.
  const hasSlides = Boolean(raw) && !lockItem && kind === "fur"; // подкладка: один виджет «Все ткани» без слайдов по тканям
  const srcList: FurSrc[] = kind === "fur" ? FUR_SRC_KEYS : ["all"];
  const typesBySrc = useMemo(() => {
    const out: Partial<Record<FurSrc, string[]>> = {};
    if (!hasSlides) return out;
    for (const sr of srcList) {
      const srcLots = tableAllSrc.filteredLots.filter((l) => inSrc(sr, l));
      const qtyOf = new Map<string, number>();
      for (const l of srcLots) qtyOf.set(l.item, (qtyOf.get(l.item) ?? 0) + l.recv);
      // Слайды видов — от самых больших объёмов («Куплено», шт.) к малым, затем по названию.
      const have = Array.from(new Set(srcLots.map((l) => l.item))).sort((a, b) => (qtyOf.get(b) ?? 0) - (qtyOf.get(a) ?? 0) || a.localeCompare(b, "ru", { numeric: true }));
      const extra = kind === "fur" && sr === "all" ? (noLotsKinds ?? []).filter((k) => !have.includes(k) && (!filters.item.length || filters.item.includes(k))) : [];
      out[sr] = [...have, ...extra];
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSlides, tableAllSrc.filteredLots, kind, noLotsKinds, filters.item]);
  const nav = useSrcTypeNav(typesBySrc, "all", scope && kind === "fur" && !lockItem ? scope : undefined);
  const sw = nav.sw;
  const src = nav.src;
  const slideKeys = useMemo(() => typesBySrc[src] ?? [], [typesBySrc, src]);
  const hasTypes = hasSlides && (typesBySrc.all?.length ?? 0) > 0;
  const slideIdx = hasTypes ? sw.cur : 0;
  const slideNow = slideIdx > 0 ? slideKeys[slideIdx - 1] ?? "" : "";
  // Мех по источникам и видам — в целых рублях, сходящихся вниз по иерархии (тем же alignRaw, что плитки Главной, src/lib/money-round.ts):
  // «На аукционах» + «У поставщика» = «Вся закупка», сумма видов = «Все типы» источника. Без фильтров «Вся закупка» — плитки Главной (raw.fur).
  const aligned = useMemo(() => {
    if (!hasTypes || !raw || kind !== "fur") return null;
    return alignFurBySource(tableAllSrc.filteredLots, typesBySrc, raw.c4, isFiltered ? null : { fur: raw.fur, lining: raw.lining });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTypes, raw, typesBySrc, tableAllSrc.filteredLots, isFiltered, kind]);
  /** Выровненные цифры (источник × тип; тип "" — «Все типы»). */
  const alignedPair = (sr: FurSrc, k: string) => (aligned ? (k ? aligned.furSrc[sr].types.find((t) => t.name === k)?.pair : aligned.furSrc[sr].total) ?? null : null);
  // Цифры (источник × тип) для долей и сверок «аукцион + поставщик = вся закупка».
  const grid = useMemo(() => {
    const g = new Map<string, FlowFigures>();
    if (!hasTypes || !raw) return g;
    const typeUnion = Array.from(new Set(srcList.flatMap((sr) => typesBySrc[sr] ?? [])));
    for (const sr of srcList) for (const k of ["", ...typeUnion]) {
      const p = alignedPair(sr, k);
      if (p) g.set(`${sr}|${k}`, p[vat]);
      else g.set(`${sr}|${k}`, figures(flowOf(tableAllSrc.filteredLots.filter((l) => inSrc(sr, l) && (!k || l.item === k))), { vat, c4: raw.c4 }));
    }
    if (!isFiltered && !aligned) g.set("all|", raw.fur[vat]);
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTypes, raw, typesBySrc, tableAllSrc.filteredLots, vat, isFiltered, kind, aligned]);
  // Плитки одного набора лотов: те же flowOf/figures, что на Главной; деньги оплат — доли аукционов по стоимости лота.
  const tilesOf = (ls: FurLot[], item: string, base?: { incl: FlowFigures; excl: FlowFigures } | null) => {
    const fl = flowOf(ls);
    const pair = base ? { ...base } : { incl: figures(fl, { vat: "incl", c4: raw?.c4 ?? "off" }), excl: figures(fl, { vat: "excl", c4: raw?.c4 ?? "off" }) };
    // Вид без лотов с $ (рысь): цена $ по расчёту позиций закупки — как в таблице и на Главной.
    const plan = item ? planUsdAvg(ls, fl) : null;
    if (plan != null) for (const v of ["incl", "excl"] as const) pair[v] = { ...pair[v], usdAvg: plan, usdRemAvg: plan, usdQty: pair[v].recvQty, usdRemQty: pair[v].remQty, usdBySource: { direct: 0, eur: 0, rub: 0, calc: pair[v].recvQty } };
    const paid = ls.reduce((a, l) => a + (l.paid ?? 0), 0);
    const due = ls.reduce((a, l) => a + (l.due ?? 0), 0);
    return { pair, paid, due, rows: rawRowsFromLots(ls) };
  };
  const slides = useMemo(() => {
    if (!raw || lockItem || !hasTypes) return null;
    const base = tableAllSrc.filteredLots.filter((l) => inSrc(src, l));
    return ["", ...slideKeys].map((k) => {
      const ls = k ? base.filter((l) => l.item === k) : base;
      return { key: k, lots: ls, data: k || src !== "all" || isFiltered ? tilesOf(ls, k, alignedPair(src, k)) : null };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, lockItem, hasTypes, src, slideKeys, tableAllSrc.filteredLots, isFiltered, aligned]);
  const tileData = useMemo(() => {
    if (!raw || !(isFiltered || scopeSrc !== "all") || !(lockItem || kind === "lining")) return null;
    return tilesOf(table.filteredLots, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, isFiltered, scopeSrc, lockItem, kind, table.filteredLots]);
  const options = useMemo(() => {
    const o = Object.fromEntries(FILTER_KEYS.map((k) => [k, filterOptions(baseLots, filters, k)])) as Record<FilterKey, ReturnType<typeof filterOptions>>;
    // Вид меха без лотов (сырьё подрядчика): есть в списке с пометкой «лотов нет» — как на Главной; выбор даёт пустую таблицу с пояснением.
    if (kind === "fur" && !lockItem) for (const k of noLotsKinds ?? []) if (!o.item.some((x) => x.value === k)) o.item = [...o.item, { value: k, label: `${k} (лотов нет)`, count: 0 }];
    return o;
  }, [baseLots, filters, kind, lockItem, noLotsKinds]);
  // Основные: партия, вид, год, цвет, размер, признак, остаток, поиск. Остальные — «Ещё фильтры» (раскрыты сами, если в них есть выбор).
  const shownKeys0: FilterKey[] = kind === "lining" ? ["auction", "item", "color", "rest", "year", "usage"] : ["auction", "item", "color", "rest", "year", "size", "attr", "usage"];
  const shownKeys = lockItem ? shownKeys0.filter((k) => k !== "item") : shownKeys0;
  // В строке — партия, вид, цвет, остаток и поиск; год, размер, признак, использование и даты — под «Показать ещё».
  const MORE_KEYS: FilterKey[] = ["year", "size", "attr", "usage"];

  const setFilter = (k: FilterKey, v: string[]) => setFilters((f) => ({ ...f, [k]: v }));
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

  const showQty = view !== "money";
  const showMoney = view !== "qty";

  const tc = makeTableCells({ kind, unit, showQty, showMoney, c4, group, cs });
  const { GROUPS, colsOf, showVat, totalCols, groupHead, colsHead, vatCells, payCells, cells, nCols, widthClass } = tc;

  const totalRowKeys = new Set(table.selectedKeys.length > 0 ? table.selectedKeys : table.rows.map((r) => r.key));

  // Строки таблицы раскрываются вглубь: [год →] вид → партия закупки → лот → ТЗ, где лот списан. Уровни зависят от «Строки по».
  const levels: Level[] = group === "auction" ? ["auction"] : group === "year" ? (lockItem ? ["year", "auction"] : yearOrder === "item" ? ["year", "item", "auction"] : ["year", "auction", "item"]) : ["item", "auction"];
  // Малые виды меха (бобр, выдра, фишер, шиншилла, рысевидная кошка…) — одной строкой «Остальной мех», по умолчанию свёрнутой, на любом уровне «вид».
  const groupMinor = (rows: TableRow[]): TableRow[] => {
    if (kind !== "fur" || lockItem) return rows;
    const minor = rows.filter((r) => !MAIN_FUR.includes(r.label));
    if (minor.length < 2) return rows;
    const flow = mergeFlows(minor.map((r) => r.flow));
    return [...rows.filter((r) => MAIN_FUR.includes(r.label)), { key: OTHER_FUR, label: "Остальной мех", lots: minor.flatMap((r) => r.lots), flow, figures: figures(flow, mode) }];
  };
  // По умолчанию строки идут от самого большого «Куплено» (шт.); клик по заголовку столбца сортирует иначе.
  const byBought = (rows: TableRow[]): TableRow[] => [...rows].sort((a, b) => b.figures.recvQty - a.figures.recvQty || a.label.localeCompare(b.label, "ru"));
  const rowsFor = (list: FurLot[], level: Level): TableRow[] =>
    level === "year" ? rowsBy(list, mode, (l) => String(l.year)) : level === "item" ? byBought(groupMinor(rowsBy(list, mode, (l) => l.item))) : byBought(rowsBy(list, mode, (l) => l.auction, (l) => l.auctionLabel));
  // Годы: новые сверху (пока не выбрана сортировка по заголовку); цифры года и «Всего» выровнены правилом money-round: сумма лет = итог.
  const yearRows = useMemo(() => (group === "year" ? rowsFor(table.rows.flatMap((r) => r.lots), "year").sort((a, b) => Number(b.key) - Number(a.key)) : []), [group, table.rows, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const yearAligned = useMemo(() => {
    if (group !== "year" || yearRows.length === 0) return null;
    const a = alignFlowSet(table.totalFigures, yearRows.map((r) => r.figures), c4 === "on");
    return { total: a.total, byKey: new Map(yearRows.map((r, i) => [r.key, a.parts[i]])) };
  }, [group, yearRows, c4, table.totalFigures]);
  // Малые виды меха (бобр, выдра, фишер, шиншилла, рысевидная кошка…) — одной строкой «Остальной мех», по умолчанию свёрнута.
  const itemRowsGrouped = useMemo(() => {
    if (kind !== "fur" || group !== "item") return table.rows;
    if (table.rows.filter((r) => !MAIN_FUR.includes(r.label)).length < 2) return byBought(table.rows);
    const minor = table.rows.filter((r) => !MAIN_FUR.includes(r.label));
    if (minor.length < 2) return table.rows;
    const flow = mergeFlows(minor.map((r) => r.flow));
    const other: TableRow = { key: OTHER_FUR, label: "Остальной мех", lots: minor.flatMap((r) => r.lots), flow, figures: figures(flow, mode) };
    return byBought([...table.rows.filter((r) => MAIN_FUR.includes(r.label)), other]);
  }, [kind, group, table.rows, mode]);
  const topRows: TableRow[] = group === "lots" ? [] : cs.sort(group === "item" ? itemRowsGrouped : group === "year" ? yearRows : rowsFor(table.rows.flatMap((r) => r.lots), "auction"));
  // Последний год открыт сразу, остальные свёрнуты (если лет больше одного).
  const yearOpened = useRef(false);
  useEffect(() => {
    if (group !== "year" || yearRows.length === 0) { yearOpened.current = false; return; }
    if (yearOpened.current) return;
    yearOpened.current = true;
    setExpanded(new Set([`g/year:${yearRows[0].key}`]));
  }, [group, yearRows]);
  const flatLots = useMemo(() => {
    if (group !== "lots") return [];
    const key = (l: FurLot) => { const f = figures(flowOf([l]), mode); return lotSort === "recv" ? f.recvValue : lotSort === "used" ? f.usedValue : f.remValue; };
    const list = [...table.filteredLots];
    if (lotSort === "num") list.sort((a, b) => (a.lotNumber ?? "").localeCompare(b.lotNumber ?? "", "ru", { numeric: true }));
    else list.sort((a, b) => key(b) - key(a));
    // Клик по заголовку столбца важнее выпадающего «Сортировка»: сравниваем показатели самого лота.
    return cs.state ? sortRows(list, cs.state, Object.fromEntries(Object.entries(colGet).map(([k, g]) => [k, (l: FurLot) => g({ figures: figures(flowOf([l]), mode), label: l.lotNumber ?? "" })]))) : list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, lotSort, table.filteredLots, mode, cs.state]);
  const { pad, renderLot, renderNode } = makeTreeRows({ kind, vat, show4, mode, expanded, toggleExp, levels, summaryOnly, lockItem, group, table, cs, byBought, rowsFor, yearAligned, showQty, showMoney, tc });

  // Фильтры таблицы — та же панель, что на остальных страницах (мгновенное применение, чипы, «Сбросить всё»);
  // лоты загружены целиком, варианты каскадные, поэтому значения считаются здесь, а адрес обновляется без перезагрузки.
  // Управление слайдами: у меха — переключатель источника + ‹ › и точки типов; у ткани — только ‹ › и точки.
  const slideCtl = hasTypes ? (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 print:hidden" data-testid="fur-slide-ctl">
      {kind === "fur" ? (scope ? null : <SegmentSwitch label="Источник закупки меха" value={src} onChange={nav.pick} options={FUR_SRC_KEYS.map((k) => ({ key: k, label: FUR_SRC_LABEL[k] }))} />) : null}
      <TypeDots accent labels={["", ...slideKeys].map((k) => k || (kind === "fur" ? ALL_TYPES_LABEL : "Все ткани"))} cur={slideIdx} goTo={sw.goTo} step={sw.step} last={sw.maxStart} ariaLabel={kind === "fur" ? "Тип меха" : "Ткань"}
        nowLabel={slideNow ? (kind === "fur" ? <Link href={`/lots/fur/${encodeURIComponent(slideNow)}`} className="hover:underline" title="Страница вида меха">{slideNow}↗</Link> : slideNow) : kind === "fur" ? ALL_TYPES_LABEL : "Все ткани"} />
    </div>
  ) : null;

  const controls: BarControl[] = [
    ...shownKeys.map((k): BarControl => ({
      type: "multi",
      name: k,
      label: FILTER_LABELS[k].kind[kind],
      allLabel: FILTER_LABELS[k].all,
      options: options[k],
      ...(MORE_KEYS.includes(k) ? { more: true } : {}),
      ...(k === "attr" ? { hint: "Седина (SIL), дикий / клеточный, тонированный… — справочник «Признаки меха» в Настройках" } : {}),
      ...(k === "auction" && kind === "fur" ? { hint: "Одна партия — откроются её счета и лоты (режим «Аукцион»); несколько — таблица сузится по ним" } : {}),
    })),
    { type: "text", name: "q", label: "Поиск", placeholder: kind === "lining" ? "№ лота, ткань, цвет, сорт" : "№ лота, материал, цвет, сорт" },
    { type: "date", name: "from", label: "Дата закупки с", more: true },
    { type: "date", name: "to", label: "Дата закупки по", more: true },
  ];

  if (liningOff) return <ScopeEmpty title="Подкладки на аукционах нет" text="Подкладка закупается у поставщика, не на аукционе, поэтому в режиме «На аукционах» она не участвует: ни таблица, ни плитки, ни оплаты подкладки здесь не показываются. В режимах «У поставщика» и «Вся закупка» подкладка показана целиком." />;

  return (
    <div className="space-y-3">
      {variant === "main" ? (
      <div className="print:hidden">
      <LocalFilterBar
        oneRow
        hideChips
        title={kind === "lining" ? "Фильтры подкладки" : "Фильтры меха"}
        controls={controls}
        values={{ ...filters, q: q ? [q] : [], from: dateFrom ? [dateFrom] : [], to: dateTo ? [dateTo] : [] }}
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
          else if (name === "from") setDateFrom(v[0] ?? "");
          else if (name === "to") setDateTo(v[0] ?? "");
          else setFilter(name as FilterKey, v);
        }}
        onReset={() => { setFilters(emptyFilters()); setQ(""); setDateFrom(""); setDateTo(""); }}
      />
      </div>
      ) : null}

      {variant === "main" && raw ? (
        <>
          {lockItem ? (
            // Страница вида меха: те же плитки, что ей передаёт страница (одна полоса итогов уровня).
            tileData ? (
              <LevelSummaryFromFigures incl={tileData.pair.incl} excl={tileData.pair.excl} paid={tileData.paid} due={tileData.due} c4={raw.c4} />
            ) : raw.tiles
          ) : (() => {
            // «Сырьё»: одна полоса итогов вместо ленты из плиток по видам и источникам — куплено → использовано → остаток → оплачено → долг.
            // Источник закупки и фильтры считаются здесь же, виды меха — строками таблицы ниже.
            const ls = kind === "fur" ? tableAllSrc.filteredLots.filter((l) => inSrc(src, l)) : tableAllSrc.filteredLots;
            const base = isFiltered ? null : kind === "fur" ? (src === "all" ? raw.fur : alignedPair(src, "")) : raw.lining;
            const t = tilesOf(ls, "", base);
            // Без фильтров и среза по источнику числа — из витрины (одним источником с остальными уровнями); иначе по отфильтрованным лотам.
            if (martTotals && !isFiltered && (kind !== "fur" || src === "all")) return <LevelSummaryFromTotals t={martTotals} c4={raw.c4} unit={kind === "lining" ? "м" : "шт."} label={kind === "lining" ? "Итоги: подкладка" : "Итоги: мех"} />;
            return <LevelSummaryFromFigures incl={t.pair.incl} excl={t.pair.excl} paid={t.paid} due={t.due} c4={raw.c4} unit={kind === "lining" ? "м" : "шт."} label={kind === "lining" ? "Итоги: подкладка" : "Итоги: мех"} />;
          })()}
          {isFiltered ? (
            <div className="px-1 text-[11px] leading-4 text-neutral-500" data-testid="tiles-filtered">
              Плитки — по фильтрам{scopeSrc !== "all" ? ` и источнику «${FUR_SRC_LABEL[scopeSrc]}»` : ""} · лотов: {table.filteredLots.length}
              <InfoHint label="Как считаются плитки при фильтрах" wide>
                <p>Куплено, Использовано и Остаток — по лотам, подходящим под фильтры (те же функции, что без фильтров). Оплачено и К оплате — доля оплат и долга партии закупки пропорционально стоимости лота, как строки «по сырью» на Главной при фильтрах.</p>
                <p className="mt-1">Без фильтров показаны плитки Главной — цифры те же.</p>
              </InfoHint>
            </div>
          ) : null}
        </>
      ) : null}
      {variant === "main" ? widgets : null}

      <PinSection id={variant === "years" ? "lots-years" : kind === "lining" ? "lots-lining-table" : "lots-raw-table"} title={variant === "years" ? "Динамика по годам" : kind === "lining" ? "Динамика по тканям" : "Динамика по сырью"} value={Array.from(expanded)} onRestore={(v) => setExpanded(new Set(v))}>
      <RowsToolbar variant={variant} kind={kind} lockItem={lockItem} group={group} setGroup={setGroup} yearOrder={yearOrder} setYearOrder={setYearOrder} yearRows={yearRows} setExpanded={setExpanded}
        lotSort={lotSort} setLotSort={setLotSort} selectedHere={selectedHere} allVisible={allVisible} setSelected={setSelected} setOnlySelected={setOnlySelected} />

      {/* Шапка (обе строки) остаётся на месте при прокрутке: таблица листается внутри рамки, до 75 % высоты экрана. */}
      <div className="scroll-hint max-h-[75vh] overflow-auto rounded-xl border border-neutral-200 [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-20">
        <table className={cn("w-full table-fixed text-[13px] tabular-nums", widthClass)}>
          <colgroup>
            {/* Первая колонка фиксированная, числовые — равные доли всей оставшейся ширины рамки (без пустого места справа). */}
            <col className="w-[230px] md:w-[250px]" />
            {Array.from({ length: totalCols }, (_, i) => <col key={i} />)}
          </colgroup>
          <thead className="bg-neutral-50 text-xs text-neutral-500">
            {groupHead}
            <tr>{colsHead}</tr>
          </thead>
          <tbody>
            {group === "lots" ? flatLots.map((l) => renderLot(l, 0, "flat", "")) : topRows.map((r) => renderNode(r, 0, "g"))}
            {kind === "fur" && scopeSrc !== "auction" && group === "item" && !lockItem && (noLotsKinds ?? []).filter((k) => !filters.item.length || filters.item.includes(k)).map((k) => (
              <tr key={`nolots:${k}`} className="border-t border-neutral-100 text-neutral-600" data-sub="no-lots">
                <td className="sticky left-0 z-10 bg-white py-2 pr-3" style={pad(0)}>
                  <div className="flex items-center whitespace-nowrap">
                    <span aria-hidden className="mr-1 inline-block w-3" />
                    <Link href={`/lots/fur/${encodeURIComponent(k)}`} className="font-medium hover:underline">{k}<span aria-hidden className="ml-1 text-[11px] text-neutral-600">↗</span></Link>
                    <span className="ml-1.5 text-xs text-neutral-500">(сырьё подрядчика)</span>
                    <InfoHint label="Что такое строка без лотов" align="left">Закупок и лотов {k.toLowerCase()} нет; значения — по ТЗ изделий из этого меха (как на Главной). В итоги не входят.</InfoHint>
                  </div>
                </td>
                {GROUPS.flatMap((g) => Array.from({ length: colsOf(g.key) }, (_, i) => {
                  const info = noLotsInfo?.[k];
                  const first = i === 0;
                  const base = cn("whitespace-nowrap px-1.5 py-2 text-right text-[13px] tabular-nums", first && "border-l border-neutral-100");
                  if (g.key === "used" && info && info.units > 0) {
                    if (i === 0) return <td key={`${g.key}${i}`} className={base}>{info.units} изд.<div className="text-[11px] text-neutral-500">{info.orders} ТЗ</div></td>;
                    if (i === 1) return <td key={`${g.key}${i}`} className={base}>{info.work > 0 ? formatMoney(info.work) : "–"}<div className="text-[11px] text-neutral-500">по ТЗ</div></td>;
                  }
                  return <td key={`${g.key}${i}`} className={cn(base, "text-neutral-500")}>–</td>;
                }))}
              </tr>
            ))}
            {table.rows.length > 0 && (
              <tr data-total className="row-total text-[14px]">
                <td className="sticky left-0 z-10 px-3 py-2.5 text-left font-semibold"><TotalLabel unit="₽" avg /></td>
                {cells(group === "year" && yearAligned ? yearAligned.total : t, { strong: true, altUsed: true })}
                {payCells(table.rows.filter((r) => totalRowKeys.has(r.key)).flatMap((r) => r.lots), { strong: true })}
                {showVat && vatCells(table.rows.filter((r) => totalRowKeys.has(r.key)).flatMap((r) => r.lots), { strong: true })}
              </tr>
            )}
            {table.rows.length === 0 && (
              <tr><td colSpan={nCols} className="px-3 py-6 text-center text-neutral-500">{lotsAll.length === 0 ? "Закупок за выбранный период нет" : lots.length === 0 && scopeSrc !== "all" ? `В режиме «${FUR_SRC_LABEL[scopeSrc]}» за выбранный период закупок нет — переключите источник на «Вся закупка»` : "Нет данных по выбранным фильтрам"}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      </PinSection>
      {raw?.after}
      {lockItem
        ? table.filteredLots.some((l) => (l.usages?.length ?? 0) > 0)
          ? <FurOrdersTable lots={table.filteredLots} kind={kind} orderInfo={orderInfo ?? {}} initialGrp={firstOf(initialQuery.grp)} />
          : <p className="rounded-lg border border-dashed border-neutral-300 px-3 py-3 text-sm text-neutral-500">Использование по ТЗ: пока не использовано{table.filteredLots.every((l) => l.id.startsWith("ordered:")) ? " (мех заказан и ещё не получен)" : ""}.</p>
        : null}
    </div>
  );
}
