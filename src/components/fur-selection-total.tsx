"use client";

import { LotUsageMini } from "@/components/lot-usage-bar";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatMoney, formatQty, cn } from "@/lib/utils";
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

const Q = (n: number | null) => (n == null || Math.abs(n) < 0.005 ? "—" : formatQty(n));
const R = (n: number | null) => (n == null || Math.abs(n) < 0.5 ? "—" : formatMoney(n));

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
  const [selected, setSelected] = useState<string[]>([]);
  const [onlySelected, setOnlySelected] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState<ViewMode>("all");
  // «Строки по»: вид меха (ткань) либо год закупки — год раскрывается в вид → партию → лот → ТЗ.
  const [group, setGroup] = useState<"item" | "year">("item");

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
  const perGroup = (showQty ? 1 : 0) + (showMoney ? 1 : 0);
  const groupHead = (
    <tr>
      <th rowSpan={2} className="sticky left-0 z-10 bg-neutral-50 px-3 py-2 text-left align-bottom font-medium">
        <span>{group === "year" ? "Год закупки" : kind === "lining" ? "Подкладка" : "Мех"}</span>
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
        </Fragment>
      ))}
    </>
  );
  const nCols = 1 + 3 * perGroup;
  // Ширины колонок рассчитаны под Inter (он шире Arial): сумма до 9 знаков + ₽ влезает без слипания с соседней колонкой.
  const widthClass = "min-w-[1000px]";

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
  const levels: Level[] = group === "year" ? ["year", "item", "auction"] : ["item", "auction"];
  const rowsFor = (list: FurLot[], level: Level): TableRow[] =>
    level === "year" ? rowsBy(list, mode, (l) => String(l.year)) : level === "item" ? rowsBy(list, mode, (l) => l.item) : rowsBy(list, mode, (l) => l.auction, (l) => l.auctionLabel);
  const topRows: TableRow[] = group === "item" ? table.rows : rowsFor(table.rows.flatMap((r) => r.lots), "year");
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
          </Fragment>
        ))}
      </tr>
    );
  };

  const renderLot = (l: FurLot, depth: number, path: string, parentLabel: string) => {
    const lk = `${path}/l:${l.id}`;
    const lOpen = expanded.has(lk);
    const canOpen = l.usages.length > 0;
    return (
      <Fragment key={lk}>
        <tr data-sub="lot" onClick={canOpen ? () => toggleExp(lk) : undefined} className={cn("border-t border-neutral-100 bg-white text-[13px]", canOpen && "cursor-pointer hover:bg-neutral-50", lOpen && "text-neutral-900")}>
          <td className="sticky left-0 z-10 bg-white py-1.5 pr-3 align-top" style={pad(depth)}>
            <div className="flex items-start gap-1">
              <span aria-hidden className={cn("inline-block w-4 shrink-0 text-neutral-500 transition-transform", lOpen && "rotate-90", !canOpen && "invisible")}>›</span>
              <div className="min-w-0">
                <div>
                  {canOpen ? <button type="button" aria-expanded={lOpen} aria-label={`Раскрыть ТЗ лота ${l.lotNumber}`} onClick={(e) => { e.stopPropagation(); toggleExp(lk); }} className="text-left">№ {l.lotNumber}</button> : <>№ {l.lotNumber}</>}
                  <Link href={`/analytics/raw/lot/${l.id}`} onClick={(e) => e.stopPropagation()} className="ml-2 text-xs text-blue-700 hover:underline" title="Карточка лота">карточка ›</Link>
                </div>
                <div className="text-xs text-neutral-500">
                  {[l.materialName !== parentLabel ? l.materialName : null, l.color !== "Не указан" ? l.color : null, l.size !== "Не указан" ? l.size : null, String(l.year)].filter(Boolean).join(" · ")}
                </div>
                {l.attrs.length > 0 && (
                  <div className="mt-0.5 flex flex-wrap gap-1" data-lot-attrs>
                    {l.attrs.map((a) => (
                      <span key={a} title="Признак меха" className="rounded-full bg-amber-50 px-1.5 text-[11px] leading-4 text-amber-800 ring-1 ring-amber-200">{a}</span>
                    ))}
                  </div>
                )}
                {l.recv > 0 && <LotUsageMini recv={l.recv} used={l.used} unit={kind === "lining" ? "м" : "шт."} className="mt-1 w-full max-w-56" />}
                {l.purchaseId && (
                  <div className="mt-0.5 text-xs text-neutral-500">
                    <Link href={`/purchases/${l.purchaseId}`} className="text-blue-700 hover:underline" onClick={(e) => e.stopPropagation()}>
                      {l.supplier ? `${l.supplier} (${l.purchaseNumber})` : l.purchaseNumber}
                    </Link>
                    {l.usages.length > 0 ? <span> · ТЗ: {l.usages.length}</span> : <span> · в ТЗ не использован</span>}
                  </div>
                )}
              </div>
            </div>
          </td>
          {cells(figures(flowOf([l]), mode), { small: true })}
        </tr>
        {lOpen ? l.usages.map((u) => renderUsage(l, u, depth + 1)) : null}
      </Fragment>
    );
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
    return (
      <Fragment key={key}>
        <tr
          data-row={depth === 0 && group === "item" ? row.key : undefined}
          data-sub={level === "auction" ? "auction" : undefined}
          onClick={() => toggleExp(key)}
          className={cn("cursor-pointer border-t border-neutral-100", depth === 0 ? "hover:bg-neutral-50" : "bg-neutral-50/70 text-[13px] hover:bg-neutral-100/70", isSel && "bg-amber-50/60 hover:bg-amber-50", open && depth > 0 && "text-neutral-900")}
        >
          <td className={cn("sticky left-0 z-10 py-2 pr-3", depth === 0 ? (isSel ? "bg-amber-50" : "bg-white") : "bg-neutral-50 py-1.5")} style={pad(depth)}>
            <button type="button" aria-expanded={open} className="min-w-0 text-left" onClick={(e) => { e.stopPropagation(); toggleExp(key); }}>
              <span aria-hidden className={cn("mr-1 inline-block w-3 text-neutral-500 transition-transform", open && "rotate-90")}>›</span>
              <span className={depth === 0 ? "font-medium" : undefined}>{row.label}</span>
              <span className="ml-1.5 text-xs text-neutral-500">{lotWord(row.lots.length)}</span>
            </button>
          </td>
          {cells(row.figures, depth === 0 ? {} : { small: true })}
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
      ...(k === "attr" ? { hint: "Седина (SIL), дикий / клеточный, тонированный… — справочник «Признаки меха» в Настройках" } : {}),
      ...(k === "auction" && kind === "fur" ? { hint: "Одна партия — откроются её счета и лоты (режим «Аукцион»); несколько — таблица сузится по ним" } : {}),
    })),
    { type: "text", name: "q", label: "Поиск", placeholder: kind === "lining" ? "№ лота, ткань, цвет, сорт" : "№ лота, материал, цвет, сорт" },
  ];

  return (
    <div className="space-y-3">
      <LocalFilterBar
        oneRow
        hideChips
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
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-xs text-neutral-500">
        <div role="tablist" aria-label="Строки по" className="flex flex-wrap items-center gap-1.5">
          <span>Строки по:</span>
          {([["item", kind === "lining" ? "Ткани" : "Виду меха"], ["year", "Году закупки"]] as const).map(([id, label]) => (
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
        {usdNote && <span className="inline-flex items-center gap-1">Цена в $: <b className="text-neutral-900">{usdNote}</b>/{unit}
          <InfoHint label="Как считается цена в $" align="left">Средняя по {t.usdQty.toLocaleString("ru-RU")} из {t.recvQty.toLocaleString("ru-RU")} шт. — только лоты с ценой в USD: в долларах в расчёте, евро × курс из расчёта, молоток ₽ ÷ курс USD/RUB из расчёта.</InfoHint></span>}
      </div>

      {/* Шапка (обе строки) остаётся на месте при прокрутке: таблица листается внутри рамки, до 75% высоты экрана. */}
      <div className="scroll-hint max-h-[75vh] overflow-auto rounded-xl border border-neutral-200 [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-20">
        <table className={cn("w-full table-fixed text-sm tabular-nums", widthClass)}>
          <colgroup>
            <col className="w-[190px] md:w-[330px]" />
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
            {topRows.map((r) => renderNode(r, 0, "g"))}
            {table.rows.length > 0 && (
              <tr data-total className="row-total text-[14px]">
                <td className="sticky left-0 z-10 px-3 py-2.5 text-left font-semibold">Всего</td>
                {cells(t, { strong: true, altUsed: true })}
              </tr>
            )}
            {table.rows.length === 0 && (
              <tr><td colSpan={nCols} className="px-3 py-6 text-center text-neutral-500">{lots.length === 0 ? "Закупок за выбранный период нет" : "Нет данных по выбранным фильтрам"}</td></tr>
            )}
          </tbody>
        </table>
      </div>
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
