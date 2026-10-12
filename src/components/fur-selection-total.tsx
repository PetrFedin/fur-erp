"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatMoney, formatPercent, formatQty, cn } from "@/lib/utils";
import { useVatDisplay } from "@/lib/vat-display";
import { InfoHint } from "@/components/info-hint";
import { TotalLabel } from "@/components/total-label";
import { LocalFilterBar, type BarControl } from "@/components/filters/filter-bar";
import { RawCards } from "@/app/(app)/dashboard/raw-block";
import { FilteredPayTiles } from "@/app/(app)/dashboard/filtered-pay-tiles";
import { rawRowsFromLots } from "@/lib/raw-rows";
import { FurOrdersTable, type OrderInfo } from "@/components/fur-orders-table";
import type { RawTableRow } from "@/lib/dashboard-data";
import {
  FILTER_KEYS, NO_AUCTION, allParamNames, buildFurTable, emptyFilters, filterOptions, filtersToEntries, figures, flowOf, hasFilters, planUsdAvg, parseFilters, rowsBy,
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
  supplier: { kind: { fur: "Поставщик", lining: "Поставщик" }, all: "Все поставщики" },
  status: { kind: { fur: "Статус закупки", lining: "Статус закупки" }, all: "Все статусы" },
  pay: { kind: { fur: "Оплата", lining: "Оплата" }, all: "Любая" },
  usage: { kind: { fur: "Использование", lining: "Использование" }, all: "Любое" },
  rate: { kind: { fur: "Ставка НДС", lining: "Ставка НДС" }, all: "Любая" },
};
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const firstOf = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Карточка /analytics/raw/lot/<id> есть только у настоящих лотов: строки «заказано, не получено» (ordered:…) и «шкуры подрядчика» (hides) — заглушки без лота в БД (404). */
const hasLotCard = (l: FurLot) => !l.id.startsWith("ordered:") && !l.id.startsWith("hides");

const Q = (n: number | null) => (n == null || Math.abs(n) < 0.005 ? "—" : formatQty(n));
const R = (n: number | null) => (n == null || Math.abs(n) < 0.5 ? "—" : formatMoney(n));
/** Средневзвешенная цена, ₽ за шт. (м): Σ ₽ ÷ Σ шт. — та же функция figures(), что даёт «Цена, ₽/шт.» в плитках. */
// Сначала до копеек (как avg в плитках: dashboard-data округляет цену до 2 знаков), затем формат — цифры совпадают с плитками.
const A = (n: number | null) => (n == null || !Number.isFinite(n) || n <= 0 ? "—" : formatMoney(Math.round(n * 100) / 100));
/** Средневзвешенная цена в долларах: только по лотам, у которых цена $ названа в документах. */
const U = (n: number | null) => (n == null || !Number.isFinite(n) || n <= 0 ? "—" : `$${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

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
  widgets,
  raw,
  lockItem,
  orderInfo,
}: {
  /** Сведения о ТЗ (артикул, партия, изделий, статус) для таблицы «Использование по ТЗ» страницы вида меха. */
  orderInfo?: Record<string, OrderInfo>;
  /** Страница вида меха: лоты уже отобраны по одному виду; фильтра «Вид» нет, строки — по аукционам или годам (год → аукцион), внизу «Использование по ТЗ». */
  lockItem?: string;
  /** Ряд виджетов (плитки сырья и оплат): стоит под панелью фильтров и над таблицей. */
  widgets?: ReactNode;
  /**
   * Плитки сырья и оплат, которые пересчитываются по фильтрам таблицы: без фильтров показывается `tiles` (серверные плитки Главной, цифры те же),
   * при любом фильтре/поиске/датах — плитки по отфильтрованным лотам (лоты несут paid/due для оплат). `after` — то, что идёт под плитками (формы подкладки).
   */
  raw?: { tiles: ReactNode; after?: ReactNode; c4: "on" | "off"; fur: { incl: FlowFigures; excl: FlowFigures }; lining: { incl: FlowFigures; excl: FlowFigures }; headerEnd?: ReactNode; rows: RawTableRow[] };
  lots: FurLot[];
  kind?: FurKind;
  /** Общий год из шапки (cookie yearFilter): лоты уже отфильтрованы им; локальный «Год закупки» сужает внутри. */
  globalYear?: string;
  initialQuery?: Record<string, string | string[] | undefined>;
}) {
  const router = useRouter();
  const unit = kind === "lining" ? "м" : "шт.";
  const unitWord = kind === "lining" ? "метр" : "шкуру";
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
  const [group, setGroup] = useState<"item" | "year" | "auction">(lockItem ? "auction" : "item");

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
  const baseLots = useMemo(() => {
    let list = needle ? lots.filter((l) => [l.lotNumber, l.materialName, l.item, l.color, l.size, l.grade, l.supplier, l.purchaseNumber, ...l.attrs].some((x) => (x ?? "").toLowerCase().includes(needle))) : lots;
    // Дата заказа закупки: строки без даты (заказано без лота, шкуры подрядчика) при заданных датах не показываются.
    if (dateFrom || dateTo) list = list.filter((l) => l.orderDate != null && (!dateFrom || l.orderDate >= dateFrom) && (!dateTo || l.orderDate <= dateTo));
    return list;
  }, [lots, needle, dateFrom, dateTo]);
  const table = useMemo(() => buildFurTable({ lots: baseLots, filters, selected, onlySelected, mode }), [baseLots, filters, selected, onlySelected, mode]);
  const tileData = useMemo(() => {
    if (!raw || !isFiltered) return null;
    const fl = flowOf(table.filteredLots);
    const pair = { incl: figures(fl, { vat: "incl", c4: raw.c4 }), excl: figures(fl, { vat: "excl", c4: raw.c4 }) };
    const paid = table.filteredLots.reduce((a, l) => a + (l.paid ?? 0), 0);
    const due = table.filteredLots.reduce((a, l) => a + (l.due ?? 0), 0);
    return { pair, paid, due, rows: rawRowsFromLots(table.filteredLots) };
  }, [raw, isFiltered, table.filteredLots]);
  const options = useMemo(
    () => Object.fromEntries(FILTER_KEYS.map((k) => [k, filterOptions(baseLots, filters, k)])) as Record<FilterKey, ReturnType<typeof filterOptions>>,
    [baseLots, filters],
  );
  const hasMoney = useMemo(() => lots.some((l) => l.paid != null), [lots]);
  // Основные: партия, вид, год, цвет, размер, признак, остаток, поиск. Остальные — «Ещё фильтры» (раскрыты сами, если в них есть выбор).
  const shownKeys0: FilterKey[] = kind === "lining" ? ["auction", "item", "year", "color", "rest", "supplier", "status", "usage", "rate"] : ["auction", "item", "year", "color", "size", "attr", "rest", "supplier", "status", "usage", "rate"];
  if (hasMoney) shownKeys0.push("pay");
  const shownKeys = lockItem ? shownKeys0.filter((k) => k !== "item") : shownKeys0;
  const MORE_KEYS: FilterKey[] = ["supplier", "status", "pay", "usage", "rate"];


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
    { key: "recv", title: "Куплено", what: "закупки", extra: "4% к закупке не применяется.", qty: (f: FlowFigures) => f.recvQty, val: (f: FlowFigures) => f.recvValue, avg: (f: FlowFigures) => f.recvAvg, usd: (f: FlowFigures) => f.usdAvg },
    { key: "used", title: "Использовано", what: "использования", extra: "4% начисляется только на строки списания, где оно разрешено.", qty: (f: FlowFigures) => f.usedQty, val: (f: FlowFigures) => f.usedValue, avg: (f: FlowFigures) => f.usedAvg, usd: (f: FlowFigures) => f.usdUsedAvg },
    { key: "rem", title: "Остаток", what: "остатка", extra: "4% к остатку не применяется (оно начисляется при списании в ТЗ).", qty: (f: FlowFigures) => f.remQty, val: (f: FlowFigures) => f.remValue, avg: (f: FlowFigures) => f.remAvg, usd: (f: FlowFigures) => f.usdRemAvg },
  ] as const;
  // Средневзвешенные цены: ₽ — всегда; $ — только по лотам, у которых цена в $ записана в расчёте лота (lotUsdPrice); нет ни у одного — «—» (курс не придумываем).
  const showUsd = kind !== "lining"; // у подкладки цены в $ нет — колонок $ нет
  // Молоток, ₽/шт. — отдельная колонка в блоке «Куплено» (цена шкуры на аукционе до сборов, выделки, транспорта, брокера и комиссий; lotHammer).
  const showHam = true;
  const colsOf = (key: string) => (showQty ? 1 : 0) + (showMoney ? 1 : 0) + 1 + (showUsd ? 1 : 0) + (showHam && key === "recv" ? 1 : 0);
  const totalCols = GROUPS.reduce((a, g) => a + colsOf(g.key), 0);
  const priceUnit = kind === "lining" ? "м" : "шт.";
  const groupHead = (
    <tr>
      <th rowSpan={2} className="sticky left-0 z-10 bg-neutral-50 px-3 py-2 text-left align-bottom font-medium">
        <span>{group === "year" ? "Год закупки" : group === "auction" ? "Партия закупки (аукцион)" : kind === "lining" ? "Подкладка" : "Мех"}</span>
      </th>
      {GROUPS.map((g) => (
        <th key={g.key} colSpan={colsOf(g.key)} className="border-b border-l border-neutral-200 px-3 pb-1 pt-2 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-600">{g.title}</th>
      ))}
    </tr>
  );
  const colsHead = (
    <>
      {GROUPS.map((g) => (
        <Fragment key={g.key}>
          {showQty && <Th first>Кол-во, {unit}</Th>}
          {showMoney && <Th first={!showQty}>Сумма, ₽</Th>}
          {g.key === "recv" ? (
            <Th>Итого цена лота, ₽/{priceUnit}<InfoHint label="Что такое итого цена лота" align="right">Финальная рублёвая цена шкуры в лоте: молоток + сборы аукциона, выделка, транспорт, брокер и комиссии (без 4%). Средневзвешенная: Σ сумма ÷ Σ шт.</InfoHint></Th>
          ) : <Th>Ср. цена, ₽/{priceUnit}</Th>}
          {showHam && g.key === "recv" && <Th>Молоток, ₽/{priceUnit}<InfoHint label="Что такое молоток" align="right">Цена шкуры на аукционе до сборов, выделки, транспорта, брокера и комиссий (в режиме «С НДС / Без НДС» шапки). Берётся из расчёта лота; средневзвешенная считается только по лотам, у которых молоток в расчёте есть. Лот без молотка — «—».</InfoHint></Th>}
          {showUsd && <Th>{g.key === "recv" ? "Молоток" : "Ср. цена"}, $/{priceUnit}<InfoHint label="Почему цена в $ не у всех" align="right">Цена в $ записана в расчёте не у всех лотов; закупки в рублях (КФХ, прочее) и подкладка без цены в $. Средневзвешенная $ считается только по лотам с ценой в $ (Σ $ × кол-во ÷ кол-во этих лотов); курс на сегодня не применяется.</InfoHint></Th>}
        </Fragment>
      ))}
    </>
  );
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
                  <span className="text-[10px] font-normal text-neutral-500">{formatPercent(o.usedBar)}</span>
                </div>
              ) : null}
            </Num>
          )}
          {showMoney && (
            g.key === "used" ? (
              <Num first={!showQty} strong={o.strong} small={o.small} title={`${c4 === "on" ? "без 4%" : "с 4%"}: ${formatMoney(f.usedValueOther)}`}>
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
                <div className="text-[10px] font-normal leading-tight text-neutral-500">по {f.hammerLots} из {f.lots} лот.</div>
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
    return have > 0 && all - have > 0.0005 ? <div className="text-[10px] font-normal leading-tight text-neutral-500">по {formatQty(have)} из {formatQty(all)}</div> : null;
  };
  const nCols = 1 + totalCols;
  // Ширины колонок рассчитаны под Inter (он шире Arial): сумма до 9 знаков + ₽ влезает без слипания с соседней колонкой.
  const widthClass = "min-w-[1500px]";

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

  // Строки таблицы раскрываются вглубь: [год →] вид → партия закупки → лот → ТЗ, где лот списан. Уровни зависят от «Строки по».
  type Level = "year" | "item" | "auction";
  const levels: Level[] = group === "auction" ? ["auction"] : group === "year" ? (lockItem ? ["year", "auction"] : ["year", "item", "auction"]) : ["item", "auction"];
  const rowsFor = (list: FurLot[], level: Level): TableRow[] =>
    level === "year" ? rowsBy(list, mode, (l) => String(l.year)) : level === "item" ? rowsBy(list, mode, (l) => l.item) : rowsBy(list, mode, (l) => l.auction, (l) => l.auctionLabel);
  const topRows: TableRow[] = group === "item" ? table.rows : rowsFor(table.rows.flatMap((r) => r.lots), group === "auction" ? "auction" : "year");
  const pad = (depth: number) => ({ paddingLeft: 12 + depth * 20 });
  const lotWord = (n: number) => `${n} лот.`;

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
            {showQty && <Num first small muted>{g.key === "used" ? Q(u.qty) : <span className="text-neutral-300">—</span>}</Num>}
            {showMoney && (
              <Num first={!showQty} small muted>
                {g.key === "used" ? <><div>{R(sumU)}</div>{extra > 0.005 ? <div className="text-[11px] text-neutral-500">4%: {R(extra)}</div> : null}</> : <span className="text-neutral-300">—</span>}
              </Num>
            )}
            <Num small muted>{g.key === "used" && u.qty > 0 ? A(sumU / u.qty) : <span className="text-neutral-300">—</span>}</Num>
            {showHam && g.key === "recv" && <Num small muted><span className="text-neutral-300">—</span></Num>}
            {showUsd && <Num small muted><span className="text-neutral-300">—</span></Num>}
          </Fragment>
        ))}
      </tr>
    );
  };

  const renderLot = (l: FurLot, depth: number, path: string, parentLabel: string) => {
    const lk = `${path}/l:${l.id}`;
    const lOpen = expanded.has(lk);
    const canOpen = l.usages.length > 0;
    const sub = [l.materialName !== parentLabel ? l.materialName : null, l.color !== "Не указан" ? l.color : null, l.size !== "Не указан" ? l.size : null, String(l.year), ...l.attrs].filter(Boolean).join(" · ");
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
                <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-neutral-400" onClick={(e) => e.stopPropagation()}>
                  <span aria-disabled="true" role="link" title="Карточки нет">—</span>
                  <InfoHint label="Почему нет карточки лота" align="left">{l.id.startsWith("hides") ? "Шкуры подрядчика: отдельной карточки лота нет, списания — в ТЗ." : "Лот не использован — детализации списаний нет."}</InfoHint>
                </span>
              )}
              {l.purchaseId ? (
                <Link href={`/purchases/${l.purchaseId}`} onClick={(e) => e.stopPropagation()} className="ml-0.5 text-[10px] text-neutral-400 hover:text-blue-700 hover:underline" title={`Закупка ${purchaseTitle}`} aria-label={`Открыть закупку ${l.purchaseNumber ?? ""}`}>↗</Link>
              ) : null}
              {l.usages.length === 0 && l.purchaseId ? <span className="ml-1 rounded-full bg-neutral-100 px-1.5 text-[10px] leading-4 text-neutral-500" title="В ТЗ не использован">не в ТЗ</span> : null}
            </div>
            <div className="truncate pl-4 text-[11px] text-neutral-500" title={[sub, purchaseTitle].filter(Boolean).join(" · ")}>{sub}</div>
          </td>
          {cells(figures(flowOf([l]), mode), { small: true, usedBar: l.recv > 0 ? pct : undefined, plan: planUsdAvg([l], flowOf([l])), lot: l })}
        </tr>
        {lOpen ? l.usages.map((u) => renderUsage(l, u, depth + 1)) : null}
      </Fragment>
    );
  };

  /** Названия-ссылки: вид меха → страница вида (/lots/fur/…), ткань → её лоты, партия → страница аукциона (/lots?auction=…). */
  const nameHref = (level: Level, row: TableRow): string | null => {
    if (level === "item") return kind === "lining" ? `/lots?tab=lining&lmat=${encodeURIComponent(row.label)}` : `/lots/fur/${encodeURIComponent(row.label)}`;
    if (level === "auction") return row.key.startsWith("Шкуры подрядчика") ? "/lots/contractor-hides" : row.key === NO_AUCTION ? null : `/lots?auction=${encodeURIComponent(row.key)}`;
    return null;
  };
  const nameTitle = (level: Level, row: TableRow) => (level === "item" ? (kind === "lining" ? "Лоты этой ткани" : `Страница вида меха «${row.label}»`) : row.key.startsWith("Шкуры подрядчика") ? "Шкуры подрядчика: детализация" : `Страница аукциона «${row.label}»`);
  const auctionSub = (row: TableRow) => {
    const dates = row.lots.map((l) => l.orderDate).filter((x): x is string => !!x).sort();
    const sup = [...new Set(row.lots.map((l) => l.supplier).filter((x): x is string => !!x))];
    const d = dates[0] ? dates[0].split("-").reverse().join(".") : "";
    return [d, sup.length === 1 ? sup[0] : sup.length > 1 ? `${sup.length} поставщ.` : ""].filter(Boolean).join(" · ") || " ";
  };
  const renderNode = (row: TableRow, depth: number, path: string): ReactNode => {
    const level = levels[depth];
    const key = `${path}/${level}:${row.key}`;
    const open = expanded.has(key);
    const isSel = depth === 0 && group === "item" && table.selectedKeys.includes(row.key);
    const inner = open
      ? depth + 1 < levels.length
        ? rowsFor(row.lots, levels[depth + 1]).map((c) => renderNode(c, depth + 1, key))
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
          onClick={() => toggleExp(key)}
          className={cn("cursor-pointer border-t border-neutral-100", depth === 0 ? "hover:bg-neutral-50" : subBg + " text-[13px] hover:bg-neutral-100/70", isSel && "bg-amber-50/60 hover:bg-amber-50", open && depth > 0 && "text-neutral-900")}
        >
          <td className={cn("sticky left-0 z-10 py-2 pr-3", depth === 0 ? (isSel ? "bg-amber-50" : "bg-white") : "bg-neutral-50 py-1.5")} style={pad(depth)}>
            <div className="flex min-w-0 items-center whitespace-nowrap">
              <button type="button" aria-expanded={open} aria-label={`${open ? "Свернуть" : "Раскрыть"}: ${row.label}`} className="shrink-0 text-left" onClick={(e) => { e.stopPropagation(); toggleExp(key); }}>
                <span aria-hidden className={cn("mr-1 inline-block w-3 text-neutral-500 transition-transform", open && "rotate-90")}>›</span>
              </button>
              {nameHref(level, row) ? (
                <Link href={nameHref(level, row)!} onClick={(e) => e.stopPropagation()} title={nameTitle(level, row)} className={cn("truncate rounded-sm hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-900", depth === 0 ? "font-medium" : undefined)}>
                  {row.label}<span aria-hidden className="ml-1 text-[10px] text-neutral-400">↗</span>
                </Link>
              ) : (
                <span className={cn("truncate", depth === 0 ? "font-medium" : undefined)}>{row.label}</span>
              )}
              <span className="ml-1.5 shrink-0 text-xs text-neutral-500">{lotWord(row.lots.length)}</span>
            </div>
            {isAuction ? <div className="truncate pl-4 text-[11px] text-neutral-500" title={auctionSub(row)}>{auctionSub(row)}</div> : null}
          </td>
          {cells(row.figures, { ...(depth === 0 ? {} : { small: true }), plan: planUsdAvg(row.lots, row.flow) })}
        </tr>
        {inner}
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
      ...(MORE_KEYS.includes(k) ? { more: true } : {}),
      ...(k === "pay" ? { hint: "Оплата партии закупки, в которой лот: оплачено полностью / частично / не оплачено" } : {}),
      ...(k === "status" ? { hint: "Принята на склад — по закупке созданы лоты; Черновик — заказано, но ещё не получено" } : {}),
      ...(k === "attr" ? { hint: "Седина (SIL), дикий / клеточный, тонированный… — справочник «Признаки меха» в Настройках" } : {}),
      ...(k === "auction" && kind === "fur" ? { hint: "Одна партия — откроются её счета и лоты (режим «Аукцион»); несколько — таблица сузится по ним" } : {}),
    })),
    { type: "text", name: "q", label: "Поиск", placeholder: kind === "lining" ? "№ лота, ткань, цвет, сорт" : "№ лота, материал, цвет, сорт" },
    { type: "date", name: "from", label: "Дата закупки с", more: true },
    { type: "date", name: "to", label: "Дата закупки по", more: true },
  ];

  return (
    <div className="space-y-3">
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

      {raw ? (
        <>
          {tileData ? (
            <RawCards
              key="raw-filtered"
              view={kind}
              rows={tileData.rows}
              fur={kind === "fur" ? tileData.pair : raw.fur}
              lining={kind === "lining" ? tileData.pair : raw.lining}
              c4={raw.c4}
              headerEnd={raw.headerEnd}
              pay={<FilteredPayTiles figs={tileData.pair.incl} paid={tileData.paid} due={tileData.due} c4={raw.c4} />}
            />
          ) : raw.tiles}
          {isFiltered ? (
            <p className="px-1 text-[11px] leading-4 text-neutral-500" data-testid="tiles-filtered">
              Плитки сырья и оплат посчитаны по выбранным фильтрам — лотов: {table.filteredLots.length}
              <InfoHint label="Как считаются плитки при фильтрах" wide>
                <p>Куплено, Использовано и Остаток — по лотам, подходящим под фильтры (те же функции, что без фильтров). Оплачено и К оплате — доля оплат и долга партии закупки пропорционально стоимости лота, как строки «по сырью» на Главной при фильтрах.</p>
                <p className="mt-1">Без фильтров показаны плитки Главной — цифры те же.</p>
              </InfoHint>
            </p>
          ) : null}
        </>
      ) : null}
      {widgets}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-xs text-neutral-500">
        <div role="tablist" aria-label="Строки по" className="flex flex-wrap items-center gap-1.5">
          <span>Строки по:</span>
          {((lockItem ? [["auction", "Аукциону"], ["year", "Году закупки"]] : [["item", kind === "lining" ? "Ткани" : "Виду меха"], ["year", "Году закупки"]]) as ReadonlyArray<readonly ["item" | "year" | "auction", string]>).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={group === id} onClick={() => { setGroup(id); setExpanded(new Set()); }}
              className={"rounded-lg border px-3 py-1.5 text-xs " + (group === id ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50")}>{label}</button>
          ))}
        </div>
        {selectedHere > 0 && (
          <span>
            Выбрано: <b className="text-neutral-900">{selectedHere}</b> из {allVisible.length}
            <button type="button" onClick={() => { setSelected([]); setOnlySelected(false); }} className="ml-2 underline">снять выбор</button>
          </span>
        )}
      </div>

      {/* Шапка (обе строки) остаётся на месте при прокрутке: таблица листается внутри рамки, до 75% высоты экрана. */}
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
            {topRows.map((r) => renderNode(r, 0, "g"))}
            {table.rows.length > 0 && (
              <tr data-total className="row-total text-[14px]">
                <td className="sticky left-0 z-10 px-3 py-2.5 text-left font-semibold"><TotalLabel unit="₽" avg /></td>
                {cells(t, { strong: true, altUsed: true })}
              </tr>
            )}
            {table.rows.length === 0 && (
              <tr><td colSpan={nCols} className="px-3 py-6 text-center text-neutral-500">{lots.length === 0 ? "Закупок за выбранный период нет" : "Нет данных по выбранным фильтрам"}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {raw?.after}
      {lockItem ? <FurOrdersTable lots={table.filteredLots} kind={kind} orderInfo={orderInfo ?? {}} /> : null}
    </div>
  );
}

function Th({ children, first }: { children: ReactNode; first?: boolean }) {
  return <th className={cn("px-2 pb-2 pt-1 text-right align-bottom font-medium leading-tight", first && "border-l border-neutral-200")}>{children}</th>;
}

function Num({ children, strong, small, muted, title, first }: { children: ReactNode; strong?: boolean; small?: boolean; muted?: boolean; title?: string; first?: boolean }) {
  return (
    <td title={title} className={cn("whitespace-nowrap px-2 py-2 text-right tabular-nums", first && "border-l border-neutral-100", small && "py-1.5 text-[13px]", strong && "font-semibold", muted && !strong && "text-neutral-500")}>
      {children}
    </td>
  );
}
