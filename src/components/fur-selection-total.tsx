"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatMoney, formatPercent, formatQty, cn, formatNum, formatDec1 } from "@/lib/utils";
import { useVatDisplay } from "@/lib/vat-display";
import { InfoHint } from "@/components/info-hint";
import { TotalLabel } from "@/components/total-label";
import { LocalFilterBar, type BarControl } from "@/components/filters/filter-bar";
import { shortMaterialName } from "@/lib/material-name";
import { ALL_TYPES_LABEL, FUR_SRC_KEYS, FUR_SRC_LABEL, SegmentSwitch, TypeDots, useSrcTypeNav, type FurSrc } from "@/components/fur-source-nav";
import { TH, THGroup } from "@/components/table-head";
import { UNIT } from "@/lib/units";
import { SortMark } from "@/components/table-head";
import { useClientSort } from "@/lib/use-client-sort";
import { sortRows, type SortVal } from "@/lib/table-sort";
import { RawCards, type RawSlide } from "@/app/(app)/dashboard/raw-block";
import { ScopeEmpty, useFurScope } from "@/components/fur-scope";
import { alignFlowSet } from "@/lib/money-round";
import { alignFurBySource } from "@/lib/fur-src-data";
import { classifyLotSource } from "@/lib/purchase-source";
import { FilteredPayTiles } from "@/app/(app)/dashboard/filtered-pay-tiles";
import { SEG_GROUP, segCls } from "@/components/segmented";
import { rawRowsFromLots } from "@/lib/raw-rows";
import { FurOrdersTable, type OrderInfo } from "@/components/fur-orders-table";
import type { RawTableRow } from "@/lib/dashboard-data";
import {
  FILTER_KEYS, NO_AUCTION, mergeFlows, allParamNames, buildFurTable, emptyFilters, filterOptions, filtersToEntries, figures, flowOf, hasFilters, lotCountLabel, planUsdAvg, parseFilters, rowsBy,
  type FilterKey, type FlowFigures, type FurFilters, type FurKind, type FurLot, type TableRow,
} from "@/lib/fur-table";

type ViewMode = "qty" | "money" | "all";

const FILTER_LABELS: Record<FilterKey, { kind: Record<FurKind, string>; all: string }> = {
  item: { kind: { fur: "Мех", lining: "Ткань" }, all: "Все" },
  year: { kind: { fur: "Год закупки", lining: "Год закупки" }, all: "Все годы" },
  color: { kind: { fur: "Цвет", lining: "Цвет" }, all: "Все цвета" },
  size: { kind: { fur: "Размер шкуры / сорт", lining: "Размер" }, all: "Все размеры" },
  attr: { kind: { fur: "Признак меха", lining: "Признак" }, all: "Все признаки" },
  auction: { kind: { fur: "Аукцион / закупка", lining: "Аукцион / закупка" }, all: "Все партии" },
  rest: { kind: { fur: "Остаток", lining: "Остаток" }, all: "Любой" },
  supplier: { kind: { fur: "Поставщик", lining: "Поставщик" }, all: "Все поставщики" },
  status: { kind: { fur: "Статус закупки", lining: "Статус закупки" }, all: "Все статусы" },
  pay: { kind: { fur: "Оплата", lining: "Оплата" }, all: "Любая" },
  usage: { kind: { fur: "Использование", lining: "Использование" }, all: "Любое" },
  rate: { kind: { fur: "Ставка НДС", lining: "Ставка НДС" }, all: "Любая" },
};
/** Источник лота для слайдов: «all» — вся закупка, остальные — по classifyLotSource (аукцион / поставщик). */
const inSrc = (s: FurSrc, l: FurLot) => s === "all" || classifyLotSource(l) === s;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const OTHER_FUR = "__other_fur";
const MAIN_FUR = ["Соболь", "Рысь", "Норка", "Свакара", "Лиса"];
const firstOf = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Карточка /analytics/raw/lot/<id> есть только у настоящих лотов: строки «заказано, не получено» (ordered:…) и «шкуры подрядчика» (hides) — заглушки без лота в БД (404). */
const hasLotCard = (l: FurLot) => !l.id.startsWith("ordered:") && !l.id.startsWith("hides");

const Q = (n: number | null) => (n == null || Math.abs(n) < 0.005 ? "–" : formatDec1(n));
const R = (n: number | null) => (n == null || Math.abs(n) < 0.5 ? "–" : formatMoney(n));
/** Средневзвешенная цена, ₽ за шт. (м): Σ ₽ ÷ Σ шт. — та же функция figures(), что даёт «Цена, ₽/шт.» в плитках. */
// Сначала до копеек (как avg в плитках: dashboard-data округляет цену до 2 знаков), затем формат — цифры совпадают с плитками.
const A = (n: number | null) => (n == null || !Number.isFinite(n) || n <= 0 ? "–" : formatMoney(Math.round(n * 100) / 100));
/** Средневзвешенная цена в долларах: только по лотам, у которых цена $ названа в документах. */
const U = (n: number | null) => (n == null || !Number.isFinite(n) || n <= 0 ? "–" : `$${formatNum(n, 1)}`);

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
}: {
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
  // Как в таблицах Главной: «Использовано» всегда без 4% (4% — отдельно, в виджетах и себестоимости).
  const c4 = "off" as "on" | "off";
  const { mode: vat } = useVatDisplay();
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

  // Колонки по показателям: Куплено (шт., ₽, ср. цена) → Использовано (…) → Остаток (…); режим шт./₽/Все прячет лишнее.
  const GROUPS = [
    { key: "recv", title: "Куплено", what: "закупки", extra: "4 % к закупке не применяется.", qty: (f: FlowFigures) => f.recvQty, val: (f: FlowFigures) => f.recvValue, avg: (f: FlowFigures) => f.recvAvg, usd: (f: FlowFigures) => f.usdAvg },
    { key: "used", title: "Использовано", what: "использования", extra: "4 % начисляется только на строки списания, где оно разрешено.", qty: (f: FlowFigures) => f.usedQty, val: (f: FlowFigures) => f.usedValue, avg: (f: FlowFigures) => f.usedAvg, usd: (f: FlowFigures) => f.usdUsedAvg },
    { key: "rem", title: "Остаток", what: "остатка", extra: "4 % к остатку не применяется (оно начисляется при списании в ТЗ).", qty: (f: FlowFigures) => f.remQty, val: (f: FlowFigures) => f.remValue, avg: (f: FlowFigures) => f.remAvg, usd: (f: FlowFigures) => f.usdRemAvg },
  ] as const;
  // Средневзвешенные цены: ₽ — всегда; $ — только по лотам, у которых цена в $ записана в расчёте лота (lotUsdPrice); нет ни у одного — «—» (курс не придумываем).
  const showUsd = kind !== "lining"; // у подкладки цены в $ нет — колонок $ нет
  // Молоток, ₽/шт. — отдельная колонка в блоке «Куплено» (цена шкуры на аукционе до сборов, выделки, транспорта, брокера и комиссий; lotHammer).
  const showHam = false; // колонка «Молоток» убрана из таблиц; молоток и «итого цена лота» — только в карточке лота
  const colsOf = (key: string) => (showQty ? 1 : 0) + (showMoney ? 1 : 0) + 1 + (showUsd ? 1 : 0) + (showHam && key === "recv" ? 1 : 0);
  // Мех и подкладка: четвёртый блок «НДС» (ставка · НДС, ₽ · НДС в ТЗ) сразу после «Остаток».
  const showVat = false; // блок «НДС» в таблице убран: НДС показан в «Использовании по ТЗ» и в плитках
  const showPay = kind === "lining"; // подкладка: блок «Оплата» (оплачено · долг) — доли оплат партии по стоимости лота, как в плитках
  const totalCols = GROUPS.reduce((a, g) => a + colsOf(g.key), 0) + (showVat ? 2 : 0) + (showPay ? 2 : 0);
  const priceUnit = kind === "lining" ? "м" : "шт.";
  const groupHead = (
    <tr>
      <th rowSpan={2} className="sticky left-0 z-10 bg-neutral-50 px-3 py-2 text-left align-middle font-medium">
        <button type="button" onClick={cs.th("name").onSort} aria-sort={cs.th("name").sort === "asc" ? "ascending" : cs.th("name").sort === "desc" ? "descending" : "none"} className="inline-flex items-center gap-1 hover:underline max-md:min-h-11">
          <span>{group === "lots" ? "Лот" : group === "year" ? "Год закупки" : group === "auction" ? "Аукцион / закупка" : kind === "lining" ? "Подкладка" : "Мех"}</span>
          <SortMark dir={cs.th("name").sort} />
        </button>
      </th>
      {GROUPS.map((g) => (
        <THGroup key={g.key} colSpan={colsOf(g.key)}>{g.title}</THGroup>
      ))}
      {showPay && <THGroup colSpan={2}>Оплата</THGroup>}
      {showVat && <th colSpan={2} className="border-b border-l border-neutral-200 px-3 pb-1 pt-2 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-600">НДС</th>}
    </tr>
  );
  const colsHead = (
    <>
      {GROUPS.map((g) => (
        <Fragment key={g.key}>
          {showQty && <TH sep label="Кол-во" unit={unit} {...cs.th(`${g.key}.qty`)} />}
          {showMoney && <TH sep={!showQty} label="Сумма" unit={UNIT.rub} {...cs.th(`${g.key}.val`)} />}
          <TH label="Ср. цена" unit={`₽/${priceUnit}`} {...cs.th(`${g.key}.avg`)} />
          {showHam && g.key === "recv" && <Th>Молоток, ₽/{priceUnit}<InfoHint label="Что такое молоток" align="right">Цена шкуры на аукционе до сборов, выделки, транспорта, брокера и комиссий (в режиме «С НДС / Без НДС» шапки). Берётся из расчёта лота; средневзвешенная считается только по лотам, у которых молоток в расчёте есть. Лот без молотка — «—».</InfoHint></Th>}
          {showUsd && <TH label="Ср. цена" unit={`$/${priceUnit}`} {...cs.th(`${g.key}.usd`)} after={<InfoHint label="Почему цена в $ не у всех" align="right">Цена в $ записана в расчёте не у всех лотов; закупки в рублях (КФХ, прочее) и подкладка без цены в $. Средневзвешенная $ считается только по лотам с ценой в $ (Σ $ × кол-во ÷ кол-во этих лотов); курс на сегодня не применяется.</InfoHint>} />}
        </Fragment>
      ))}
      {showPay && (
        <>
          <TH sep label="Оплачено" unit={UNIT.rub} />
          <TH label="Долг" unit={UNIT.rub} />
        </>
      )}
      {showVat && (
        <>
          <TH sep label="Ставка" />
          <TH label="НДС" unit={UNIT.rub} />
        </>
      )}
    </>
  );
  /** Колонки блока «НДС» по набору лотов: ставки лотов, НДС купленного (с НДС − без НДС), «НДС в ТЗ» у ткани. */
  const vatCells = (ls: FurLot[], o: { strong?: boolean; small?: boolean; tz?: ReactNode; single?: boolean } = {}) => {
    const byRate = new Map<number, number>();
    for (const l of ls) byRate.set(l.vatRate, (byRate.get(l.vatRate) ?? 0) + (l.recvIncl - l.recvExcl));
    const rates = [...byRate.keys()].sort((a, b) => a - b);
    const sum = [...byRate.values()].reduce((a, v) => a + v, 0);
    const detail = rates.map((r) => `${r} %: ${formatMoney(byRate.get(r) ?? 0)}`).join(" · ");
    const l0 = ls[0];
    return (
      <>
        <Num first strong={o.strong} small={o.small}>
          {rates.length ? rates.map((r) => `${r} %`).join(" · ") : <span className="text-neutral-500">–</span>}
          {o.single && l0 ? <div className="text-[11px] font-normal leading-tight text-neutral-500">{l0.year < 2026 ? "куплено до 2026" : "с 2026"}</div> : null}
        </Num>
        <Num strong={o.strong} small={o.small} title={detail ? `в т.ч. ${detail}` : undefined}>
          {R(sum)}
          {rates.length > 1 ? <div className="text-[11px] font-normal leading-tight text-neutral-500">{detail}</div> : null}
        </Num>
      </>
    );
  };
  /** Оплачено и долг по набору лотов (поля лота paid/due — те же, что питают плитки оплат). */
  const payCells = (ls: FurLot[], o: { strong?: boolean; small?: boolean } = {}) => {
    if (!showPay) return null;
    const paid = ls.reduce((a, l) => a + (l.paid ?? 0), 0);
    const due = ls.reduce((a, l) => a + (l.due ?? 0), 0);
    return (
      <>
        <Num first strong={o.strong} small={o.small}>{R(paid)}</Num>
        <Num strong={o.strong} small={o.small}><span className={due > 0.5 ? "text-amber-700" : undefined}>{R(due)}</span></Num>
      </>
    );
  };
  const cells = (f: FlowFigures, o: { strong?: boolean; altUsed?: boolean; small?: boolean; usedBar?: number; plan?: number | null; lot?: FurLot } = {}) => (
    <>
      {GROUPS.map((g) => (
        <Fragment key={g.key}>
          {showQty && (
            <Num first strong={o.strong} small={o.small}>
              {Q(g.qty(f))}
              {g.key === "used" && o.usedBar != null ? (
                <div className="mt-0.5 flex items-center justify-end gap-1" title={`Использовано ${formatPercent(o.usedBar)} от купленного`}>
                  <span role="img" aria-label={`Использовано ${formatPercent(o.usedBar)}`} className="h-1.5 w-full max-w-16 overflow-hidden rounded-full" style={{ background: "#e7e5e4" }}>
                    <span className="block h-full" style={{ width: `${o.usedBar}%`, background: "var(--ui-accent)" }} />
                  </span>
                  <span className="text-[11px] font-normal text-neutral-500">{formatPercent(o.usedBar)}</span>
                </div>
              ) : null}
            </Num>
          )}
          {showMoney && (
            g.key === "used" ? (
              <Num first={!showQty} strong={o.strong} small={o.small} title={`${c4 === "on" ? "без 4 %" : "с 4 %"}: ${formatMoney(f.usedValueOther)}`}>
                <div>{R(f.usedValue)}</div>
                
              </Num>
            ) : (
              <Num first={!showQty} strong={o.strong} small={o.small}>{R(g.val(f))}</Num>
            )
          )}
          <Num strong={o.strong} small={o.small}>{A(g.avg(f))}</Num>
          {showHam && g.key === "recv" && (
            <Num strong={o.strong} small={o.small}>
              {A(f.hammerAvg)}
              {o.lot ? (
                <InfoHint label="Источник молотка" align="right">{o.lot.hammerSource ? `Молоток: ${o.lot.hammerSource}.` : "Нет цены в $/молотка в расчёте лота."}</InfoHint>
              ) : f.hammerAvg != null && f.hammerQty > 0 && f.recvQty - f.hammerQty > 0.0005 ? (
                <div className="text-[11px] font-normal leading-tight text-neutral-500" title={`Цена в $ есть у ${f.hammerLots} из ${f.lots} лотов`}>{f.hammerLots} / {f.lots} лот.</div>
              ) : null}
            </Num>
          )}
          {showUsd && <Num strong={o.strong} small={o.small}>{U(g.key !== "used" && o.plan != null && g.usd(f) == null ? o.plan : g.usd(f))}{o.plan != null && g.usd(f) == null ? null : usdNote(g.key, f)}</Num>}
        </Fragment>
      ))}
    </>
  );
  // Охват цены в $: «по N из M» — когда $ есть не у всех шкур (метров) строки.
  const usdNote = (key: string, f: FlowFigures) => {
    const have = key === "recv" ? f.usdQty : key === "used" ? f.usdUsedQty : f.usdRemQty;
    const all = key === "recv" ? f.recvQty : key === "used" ? f.usedQty : f.remQty;
    if (all <= 0.0005) return null;
    const u = kind === "lining" ? "м" : "шт.";
    return <div className="text-[11px] font-normal leading-tight text-neutral-500" title={`Средняя цена в $ посчитана по ${formatQty(have)} из ${formatQty(all)} ${u}: у остальных в расчёте лота нет цены в $`}>по {formatQty(have)} из {formatQty(all)} {u}</div>;
  };
  const nCols = 1 + totalCols;
  // Ширины колонок рассчитаны под Inter (он шире Arial): сумма до 9 знаков + ₽ влезает без слипания с соседней колонкой.
  const widthClass = kind === "lining" ? "min-w-[1300px]" : "min-w-[1500px]";

  const totalRowKeys = new Set(table.selectedKeys.length > 0 ? table.selectedKeys : table.rows.map((r) => r.key));

  // Строки таблицы раскрываются вглубь: [год →] вид → партия закупки → лот → ТЗ, где лот списан. Уровни зависят от «Строки по».
  type Level = "year" | "item" | "auction";
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
  const pad = (depth: number) => ({ paddingLeft: 12 + depth * (kind === "lining" ? 12 : 20) });

  /** Строка ТЗ: сколько лота ушло в это ТЗ, на какую сумму (без 4%), цена за единицу и надбавка 4%. */
  const renderUsage = (l: FurLot, u: FurLot["usages"][number], depth: number) => {
    const sumU = vat === "incl" ? u.incl : u.excl;
    const extra = vat === "incl" ? u.extraIncl : u.extraExcl;
    return (
      <tr key={`u:${l.id}:${u.orderId}`} data-sub="usage" className="border-t border-neutral-100 bg-neutral-50/70 text-xs text-neutral-600">
        <td className="sticky left-0 z-10 bg-neutral-50 py-1.5 pr-3" style={pad(depth)}>
          <Link href={`/production/${u.orderId}`} className="text-blue-700 hover:underline">ТЗ {u.number}</Link>
          <span className="ml-1.5 text-neutral-500">{u.qty > 0 ? `${formatMoney(sumU / u.qty)}/${kind === "lining" ? "м" : "шт."}` : ""}</span>
        </td>
        {GROUPS.map((g) => (
          <Fragment key={g.key}>
            {showQty && <Num first small muted>{g.key === "used" ? Q(u.qty) : <span className="text-neutral-500">–</span>}</Num>}
            {showMoney && (
              <Num first={!showQty} small muted>
                {g.key === "used" ? <><div>{R(sumU)}</div>{extra > 0.005 ? <div className="text-[11px] text-neutral-500">4 %: {R(extra)}</div> : null}</> : <span className="text-neutral-500">–</span>}
              </Num>
            )}
            <Num small muted>{g.key === "used" && u.qty > 0 ? A(sumU / u.qty) : <span className="text-neutral-500">–</span>}</Num>
            {showHam && g.key === "recv" && <Num small muted><span className="text-neutral-500">–</span></Num>}
            {showUsd && <Num small muted><span className="text-neutral-500">–</span></Num>}
          </Fragment>
        ))}
        {showPay && <><Num first small muted><span className="text-neutral-500">–</span></Num><Num small muted><span className="text-neutral-500">–</span></Num></>}
        {showVat && <><Num first small muted><span className="text-neutral-500">–</span></Num><Num small muted><span className="text-neutral-500">–</span></Num></>}
      </tr>
    );
  };

  const renderLot = (l: FurLot, depth: number, path: string, parentLabel: string) => {
    const lk = `${path}/l:${l.id}`;
    const lOpen = expanded.has(lk);
    const canOpen = l.usages.length > 0;
    const sub = [path === "flat" ? l.auctionLabel : null, l.materialName !== parentLabel ? l.materialName : null, l.color !== "Не указан" ? l.color : null, l.size !== "Не указан" ? l.size : null, String(l.year), ...l.attrs].filter(Boolean).join(" · ");
    const purchaseTitle = [l.supplier, l.purchaseNumber].filter(Boolean).join(" · ");
    const pct = l.recv > 0 ? Math.min(100, (l.used / l.recv) * 100) : 0;
    return (
      <Fragment key={lk}>
        <tr data-sub="lot" onClick={canOpen ? () => toggleExp(lk) : undefined} className={cn("border-t border-neutral-100 bg-white text-[13px]", canOpen && "cursor-pointer hover:bg-neutral-50", lOpen && "text-neutral-900")}>
          <td className="sticky left-0 z-10 bg-white py-1.5 pr-3 align-top" style={pad(depth)}>
            <div className="flex items-center gap-1 whitespace-nowrap">
              <span aria-hidden className={cn("inline-block w-3 shrink-0 text-neutral-500 transition-transform", lOpen && "rotate-90", !canOpen && "invisible")}>›</span>
              {canOpen ? <button type="button" aria-expanded={lOpen} aria-label={`Раскрыть ТЗ лота ${l.lotNumber}`} onClick={(e) => { e.stopPropagation(); toggleExp(lk); }} className="text-left font-medium">№ {l.lotNumber}</button> : <span className="font-medium">№ {l.lotNumber}</span>}
              {hasLotCard(l) ? (
                <Link href={`/analytics/raw/lot/${l.id}`} onClick={(e) => e.stopPropagation()} className="ml-1 text-[11px] text-blue-700 hover:underline" title="Карточка лота">карточка ›</Link>
              ) : (
                // Карточки нет (строка-заглушка «заказано, не получено» / «шкуры подрядчика»): приглушённый «—» с пояснением в «i».
                <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-neutral-600" onClick={(e) => e.stopPropagation()}>
                  <span aria-disabled="true" role="link" title="Карточки нет">–</span>
                  <InfoHint label="Почему нет карточки лота" align="left">{l.id.startsWith("hides") ? "Шкуры подрядчика: отдельной карточки лота нет, списания — в ТЗ." : "Лот не использован — детализации списаний нет."}</InfoHint>
                </span>
              )}
              {l.purchaseId ? (
                <Link href={`/purchases/${l.purchaseId}`} onClick={(e) => e.stopPropagation()} className="ml-0.5 text-[11px] text-neutral-600 hover:text-blue-700 hover:underline" title={`Закупка ${purchaseTitle}`} aria-label={`Открыть закупку ${l.purchaseNumber ?? ""}`}>↗</Link>
              ) : null}
            </div>
            <div className="truncate pl-4 text-[11px] text-neutral-500" title={[sub, purchaseTitle].filter(Boolean).join(" · ")}>{sub}</div>
          </td>
          {cells(figures(flowOf([l]), mode), { small: true, usedBar: l.recv > 0 ? pct : undefined, plan: planUsdAvg([l], flowOf([l])), lot: l })}
          {payCells([l], { small: true })}
          {showVat && vatCells([l], { small: true, single: true })}
        </tr>
        {lOpen ? l.usages.map((u) => renderUsage(l, u, depth + 1)) : null}
      </Fragment>
    );
  };

  /** Названия-ссылки: вид меха → страница вида (/lots/fur/…), ткань → её лоты, партия → страница аукциона (/lots?auction=…). */
  const nameHref = (level: Level, row: TableRow): string | null => {
    if (level === "item") return kind === "lining" ? `/lots?tab=lining&lmat=${encodeURIComponent(row.label)}` : `/lots/fur/${encodeURIComponent(row.label)}`;
    if (level === "auction") return row.key.startsWith("Шкуры подрядчика") ? "/lots/contractor-hides" : row.key === NO_AUCTION ? null : kind === "lining" ? `/lots/lining/${encodeURIComponent(row.key)}` : `/lots?auction=${encodeURIComponent(row.key)}`;
    return null;
  };
  const nameTitle = (level: Level, row: TableRow) => (level === "item" ? (kind === "lining" ? "Лоты этой ткани" : `Страница вида меха «${row.label}»`) : row.key.startsWith("Шкуры подрядчика") ? "Шкуры подрядчика: детализация" : `Страница аукциона «${row.label}»`);
  const auctionSub = (row: TableRow) => {
    const dates = row.lots.map((l) => l.orderDate).filter((x): x is string => !!x).sort();
    const sup = [...new Set(row.lots.map((l) => l.supplier).filter((x): x is string => !!x))];
    const d = dates[0] ? dates[0].split("-").reverse().join(".") : "";
    return [d, sup.length === 1 ? sup[0] : sup.length > 1 ? `${sup.length} поставщ.` : ""].filter(Boolean).join(" · ") || " ";
  };
  // Название ткани: «Ткань №N» / сокращение известных длинных названий, остальное переносится на 2 строки (без «…»); полное — в title.
  const wrapName = kind === "lining";
  const shown = (level: Level, row: TableRow) => (kind === "lining" && level === "item" ? shortMaterialName(row.label) : row.label);
  // off — сдвиг уровней: под строкой «Остальной мех» (малые виды меха) идут виды, затем аукционы.
  const renderNode = (row: TableRow, depth: number, path: string, off = 0): ReactNode => {
    const synth = row.key === OTHER_FUR;
    const level: Level = synth ? "item" : levels[depth - off];
    const key = `${path}/${level}:${row.key}`;
    const open = expanded.has(key);
    const leaf = Boolean(summaryOnly) && !lockItem && !synth && depth + 1 - off >= levels.length;
    const isSel = depth === 0 && group === "item" && table.selectedKeys.includes(row.key);
    const inner = open && !leaf
      ? synth
        ? cs.sort(byBought(rowsBy(row.lots, mode, (l) => l.item))).map((c) => renderNode(c, depth + 1, key, off + 1))
        : depth + 1 - off < levels.length
          ? cs.sort(rowsFor(row.lots, levels[depth + 1 - off])).map((c) => renderNode(c, depth + 1, key, off))
          : row.lots.map((l) => renderLot(l, depth + 1, key, row.label))
      : null;
    // Оранжевая полоска слева (тема customer: bg-neutral-50/70) — только у родительских строк «год» и «вид меха»; у аукциона — лёгкий фон без полоски.
    const isAuction = level === "auction";
    const subBg = isAuction ? "bg-neutral-50/40" : "bg-neutral-50/70";
    return (
      <Fragment key={key}>
        <tr
          data-row={depth === 0 && group === "item" ? row.key : undefined}
          data-sub={isAuction ? "auction" : undefined}
          onClick={leaf ? undefined : () => toggleExp(key)}
          className={cn(leaf ? "border-t border-neutral-100" : "cursor-pointer border-t border-neutral-100", depth === 0 ? "hover:bg-neutral-50" : subBg + " text-[13px] hover:bg-neutral-100/70", isSel && "bg-amber-50/60 hover:bg-amber-50", open && depth > 0 && "text-neutral-900")}
        >
          <td className={cn("sticky left-0 z-10 py-2 pr-3", depth === 0 ? (isSel ? "bg-amber-50" : "bg-white") : "bg-neutral-50 py-1.5")} style={pad(depth)}>
            <div className="flex min-w-0 items-center whitespace-nowrap">
              {leaf ? <span aria-hidden className="mr-1 inline-block w-3" /> : (
              <button type="button" aria-expanded={open} aria-label={`${open ? "Свернуть" : "Раскрыть"}: ${row.label}`} className="shrink-0 text-left" onClick={(e) => { e.stopPropagation(); toggleExp(key); }}>
                <span aria-hidden className={cn("mr-1 inline-block w-3 text-neutral-500 transition-transform", open && "rotate-90")}>›</span>
              </button>)}
              {!synth && nameHref(level, row) ? (
                <Link href={nameHref(level, row)!} onClick={(e) => e.stopPropagation()} title={row.label === shown(level, row) ? nameTitle(level, row) : row.label} className={cn(wrapName ? "line-clamp-2 whitespace-normal break-words leading-tight" : "truncate", "rounded-sm hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-900", depth === 0 ? "font-medium" : undefined)}>
                  {shown(level, row)}<span aria-hidden className="ml-1 text-[11px] text-neutral-600">↗</span>
                </Link>
              ) : (
                <span className={cn(wrapName ? "line-clamp-2 whitespace-normal break-words leading-tight" : "truncate", depth === 0 ? "font-medium" : undefined)} title={row.label}>{shown(level, row)}</span>
              )}
            </div>
            <div className="truncate pl-4 text-[11px] leading-4 text-neutral-500" title={lotCountLabel(row.lots)}>{lotCountLabel(row.lots)}</div>
            {isAuction ? <div className="truncate pl-4 text-[11px] text-neutral-500" title={auctionSub(row)}>{auctionSub(row)}</div> : null}
          </td>
          {cells(depth === 0 && group === "year" ? yearAligned?.byKey.get(row.key) ?? row.figures : row.figures, { ...(depth === 0 ? {} : { small: true }), plan: planUsdAvg(row.lots, row.flow) })}
          {payCells(row.lots, depth === 0 ? {} : { small: true })}
          {showVat && vatCells(row.lots, { small: depth !== 0 })}
        </tr>
        {inner}
      </Fragment>
    );
  };

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
          {slides ? (() => {
            const G = (sr: FurSrc, k: string) => grid.get(`${sr}|${k}`) as FlowFigures;
            const used$ = (f: FlowFigures) => (raw.c4 === "on" ? f.usedValueOther : f.usedValue); // «Использовано» без 4 % — как в плитке
            const chk: [string, (f: FlowFigures) => number, boolean][] = [["куплено", (f) => f.recvQty, false], ["куплено", (f) => f.recvValue, true], ["использовано", (f) => f.usedQty, false], ["использовано", used$, true], ["остаток", (f) => f.remQty, false], ["остаток", (f) => f.remValue, true]];
            const pctOf = (a: number, b: number) => (b > 0 ? formatPercent((a / b) * 100) : "–");
            const shareNote = (of: FlowFigures, f: FlowFigures, what: string, from: string) => <span title={`${what} в «${from}» по количеству и по сумме`}>{what}: {pctOf(f.recvQty, of.recvQty)} шт. · {pctOf(f.recvValue, of.recvValue)} ₽</span>;
            const checkLine = (lhs: string, parts: FlowFigures[], whole: FlowFigures, testid: string) => {
              const sum = (g: (f: FlowFigures) => number) => parts.reduce((a, f) => a + g(f), 0);
              const dif = (g: (f: FlowFigures) => number) => g(whole) - sum(g);
              const rounding = chk.filter(([, g]) => Math.abs(dif(g)) >= 0.5).map(([n, g, m]) => `${n} ${m ? formatMoney(dif(g)) : formatQty(dif(g)) + " шт."}`);
              return (
                <p className="mt-1 first:mt-0" data-testid={testid}>
                  {lhs}: куплено {formatDec1(sum((f) => f.recvQty))} шт., {formatMoney(sum((f) => f.recvValue))}; использовано {formatDec1(sum((f) => f.usedQty))} шт., {formatMoney(sum(used$))}; остаток {formatDec1(sum((f) => f.remQty))} шт., {formatMoney(sum((f) => f.remValue))}
                  {rounding.length ? `; округление: ${rounding.join(", ")}` : ""}.
                </p>
              );
            };
            const srcHint = (
              <InfoHint label="Что значат источники" align="left" wide>
                <p><b>На аукционах</b> — закупки, привязанные к аукциону справочника (SAGA, Kopenhagen, Fur Harvesters, AME, Союзпушнина, Русьпушнина). Включая заказанное, но не полученное (СП 09.26, FH 06.26): лотов по нему нет, остаток = заказанное, использовано 0.</p>
                <p className="mt-1"><b>У поставщика</b> — закупки без аукциона: напрямую у поставщика или фермы (КФХ), белая норка №80/№96, красная лиса со склада и шкуры подрядчика (сырьё Веллмех в счетах за пошив).</p>
                <p className="mt-1">«На аукционах» + «У поставщика» = «Вся закупка», сумма типов = «Все типы» источника (до рубля и штуки). «Использовано» — без 4 %.</p>
              </InfoHint>
            );
            const pane: RawSlide[] = slides.map((sl) => {
              const d = sl.data;
              const fur = kind === "fur" && d ? d.pair : kind === "fur" && aligned && !isFiltered ? aligned.fur : raw.fur;
              const lining = kind === "lining" && d ? d.pair : raw.lining;
              let recvNote: ReactNode;
              let below: ReactNode = null;
              if (kind === "fur") {
                if (!sl.key) recvNote = src === "all" ? undefined : shareNote(G("all", ""), G(src, ""), "Доля", FUR_SRC_LABEL.all);
                else recvNote = shareNote(G(src, ""), G(src, sl.key), "Доля вида", FUR_SRC_LABEL[src]);
                const parts = [G("auction", sl.key), G("supplier", sl.key)];
                const bySrc = checkLine(`«На аукционах» + «У поставщика» = «Вся закупка»${sl.key ? ` · ${sl.key}` : ""}`, parts, G("all", sl.key), "source-check");
                const byType = !sl.key && slideKeys.length > 0 ? checkLine(`Сумма типов (${slideKeys.length}) = «Все типы» · «${FUR_SRC_LABEL[src]}»`, slideKeys.map((k) => G(src, k)), G(src, ""), "type-check") : null;
                below = <div className="mt-1 flex items-center gap-1 px-1 text-[11px] leading-4 text-neutral-500">Сверка
                  <InfoHint label="Сверка сумм" align="left" wide><div className="space-y-1">{byType}{bySrc}</div>{srcHint}</InfoHint></div>;
              }
              return {
                key: `${src}:${sl.key || "all"}`, label: sl.key || (kind === "fur" ? ALL_TYPES_LABEL : "Все ткани"), fur, lining,
                pay: d ? <FilteredPayTiles figs={d.pair.incl} paid={d.paid} due={d.due} c4={raw.c4} /> : raw.pay ?? null,
                recvNote, below,
              };
            });
            const curData = slides[Math.min(slideIdx, slides.length - 1)]?.data;
            return (
              <RawCards key="raw-slides" view={kind} slides={pane} slideWindow={sw}
                rows={curData?.rows ?? raw.rows}
                fur={kind === "fur" && curData ? curData.pair : raw.fur}
                lining={kind === "lining" && curData ? curData.pair : raw.lining}
                c4={raw.c4} headerEnd={raw.headerEnd} titleSuffix={(kind === "fur" ? FUR_SRC_LABEL[src] + (slideNow ? ` · ${slideNow}` : "") : slideNow) || undefined} headerExtra={slideCtl} />
            );
          })() : lockItem || kind === "lining" ? (
            <>
              {tileData ? (
                <RawCards key="raw-filtered" view={kind} rows={tileData.rows} fur={kind === "fur" ? tileData.pair : raw.fur} lining={kind === "lining" ? tileData.pair : raw.lining} c4={raw.c4} headerEnd={raw.headerEnd}
                  pay={<FilteredPayTiles figs={tileData.pair.incl} paid={tileData.paid} due={tileData.due} c4={raw.c4} />} />
              ) : raw.tiles}
            </>
          ) : raw.tiles}
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

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-xs text-neutral-500">
        {variant === "years" ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-neutral-800">
            <h3 className="text-sm font-semibold">Динамика по годам</h3>
            <div role="group" aria-label="Порядок уровней" className={SEG_GROUP}>
              {([["item", "Год → сырьё → аукцион"], ["auction", "Год → аукцион → сырьё"]] as const).map(([k, t]) => <button key={k} type="button" aria-pressed={yearOrder === k} onClick={() => { setYearOrder(k); setExpanded(new Set([...(yearRows[0] ? [`g/year:${yearRows[0].key}`] : [])])); }} className={segCls(yearOrder === k)}>{t}</button>)}
            </div>
          </div>
        ) : (
        <>
        <h3 className="basis-full text-sm font-semibold text-neutral-800">{kind === "lining" ? "Динамика по тканям" : "Динамика по сырью"}</h3>
        <div role="tablist" aria-label="Строки по" className="flex flex-wrap items-center gap-1.5">
          <span>Строки по:</span>
          {((lockItem ? [["auction", "Аукциону"], ["year", "Году закупки"], ["lots", "Списком лотов"]] : [["item", kind === "lining" ? "Ткани" : "Виду меха"], ...(kind === "fur" ? [] : [["year", "Году закупки"] as const]), ["lots", "Списком лотов"]] as const) as ReadonlyArray<readonly ["item" | "year" | "auction" | "lots", string]>).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={group === id} onClick={() => { setGroup(id); setExpanded(new Set()); }}
              className={"rounded-lg border px-3 py-1.5 text-xs " + (group === id ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50")}>{label}</button>
          ))}
        </div>
        </>
        )}
        {group === "lots" && (
          <label className="inline-flex items-center gap-1.5">
            Сортировка:
            <select value={lotSort} onChange={(e) => setLotSort(e.target.value as typeof lotSort)} className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-700">
              <option value="num">№ лота</option>
              <option value="recv">Куплено, ₽ (по убыванию)</option>
              <option value="used">Использовано, ₽ (по убыванию)</option>
              <option value="rem">Остаток, ₽ (по убыванию)</option>
            </select>
          </label>
        )}
        {selectedHere > 0 && (
          <span>
            Выбрано: <b className="text-neutral-900">{selectedHere}</b> из {allVisible.length}
            <button type="button" onClick={() => { setSelected([]); setOnlySelected(false); }} className="ml-2 underline">снять выбор</button>
          </span>
        )}
      </div>

      {/* Шапка (обе строки) остаётся на месте при прокрутке: таблица листается внутри рамки, до 75 % высоты экрана. */}
      <div className="scroll-hint max-h-[75vh] overflow-auto rounded-xl border border-neutral-200 [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-20">
        <table className={cn("w-full table-fixed text-sm tabular-nums", widthClass)}>
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
                  const base = cn("whitespace-nowrap px-2 py-2 text-right tabular-nums", first && "border-l border-neutral-100");
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

      {raw?.after}
      {lockItem ? <FurOrdersTable lots={table.filteredLots} kind={kind} orderInfo={orderInfo ?? {}} initialGrp={firstOf(initialQuery.grp)} /> : null}
    </div>
  );
}

function Th({ children, first }: { children: ReactNode; first?: boolean }) {
  return <th className={cn("px-2 py-1.5 text-right align-middle font-medium leading-tight", first && "border-l border-neutral-200")}>{children}</th>;
}

function Num({ children, strong, small, muted, title, first }: { children: ReactNode; strong?: boolean; small?: boolean; muted?: boolean; title?: string; first?: boolean }) {
  return (
    <td title={title} className={cn("whitespace-nowrap px-2 py-2 text-right tabular-nums", first && "border-l border-neutral-100", small && "py-1.5 text-[13px]", strong && "font-semibold", muted && !strong && "text-neutral-500")}>
      {children}
    </td>
  );
}
