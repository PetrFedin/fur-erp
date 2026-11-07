"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { InfoHint } from "@/components/info-hint";
import { PhotoGalleryButton } from "@/components/photo-gallery";
import { toCsv } from "@/lib/csv";
import { makeCtx, type Ctx, type ReportSizeRow } from "@/lib/margin-tree";
import { deserializeInput, type MarginInputS } from "@/lib/margin";
import {
  buildSalesTree, sizeNodes, sortSeasons, STRUCTS, STRUCT_SHORT, SDIM_LABEL, totalSalesNode, walkTree,
  type Cat, type Env, type Ext, type SLine, type SNode, type Struct,
} from "@/lib/sales-section";
import { movementHref, type MKey } from "@/lib/sales-url";
import { articleKey, colorOfLine } from "@/lib/sales-receipts-core";
import { furKeyOfRow } from "./season-report";
import { DASH, btn, d1, dateRu, money, n0, pct, seg, segGroup, spct, x2 } from "./sales-fmt";

export type PhotoIdx = Record<string, { modelId: string; photos: { id: string; variant: string; color?: string; itemId?: string }[] }>;

type Measure = { key: MKey; label: string; hint: React.ReactNode; money?: boolean; eur?: boolean; totalOnly?: boolean; fmt: (m: Ext) => string };
export const MEASURES: Measure[] = [
  { key: "conf", label: "Заказано, шт.", hint: <p>Подтверждённый заказ по отчёту «заказ и продажи», шт., по меху, категории, артикулу и цвету узла. В столбце сезона — заказ этого сезона (по закрытым сезонам заказано = поступило). Размеры — без заказа.</p>, fmt: () => DASH },
  { key: "received", label: "Получено, шт.", hint: <p>Получено единиц по строкам прихода, корректировки с минусом учтены.</p>, fmt: (m) => n0(m.received) },
  { key: "sold", label: "Продано, шт.", hint: <p>Проданные единицы нетто, возвраты минус.</p>, fmt: (m) => n0(m.sold) },
  { key: "returns", label: "Возвраты, шт.", hint: <p>Возвраты: модуль отрицательных штук в строках продаж.</p>, fmt: (m) => n0(m.returns) },
  { key: "stock", label: "Остаток, шт.", hint: <p>Расчётный остаток = получено − продано.</p>, fmt: (m) => n0(m.stock) },
  { key: "sellThrough", label: "Распродано, %", hint: <p>Продано ÷ получено, единицы. Без обрезки до 100 %: больше 100 % значит, что продажи включают остатки других поступлений.</p>, fmt: (m) => pct(m.sellThrough) },
  { key: "revenue", label: "Выручка", money: true, hint: <p>Розничная выручка после скидки, возвраты минус; с НДС или без — по переключателю.</p>, fmt: (m) => money(m.revenue) },
  { key: "revenueEur", label: "Выручка", money: true, eur: true, hint: <p>Розничная выручка в евро после скидки, возвраты минус; с НДС или без — по переключателю.</p>, fmt: (m) => eur(m.revenueEur) },
  { key: "grossRev", label: "Розница до скидки", money: true, hint: <p>Розница до скидки = Выручка + Скидка.</p>, fmt: (m) => money(m.grossRev) },
  { key: "discountSum", label: "Скидка", money: true, hint: <p>Discount файла, уже вычтен из выручки.</p>, fmt: (m) => money(m.discountSum) },
  { key: "discountGiven", label: "Скидка, %", hint: <p>Скидка при продаже = Скидка ÷ розница до скидки.</p>, fmt: (m) => pct(m.discountGiven === null ? null : m.discountGiven, 1) },
  { key: "avgPrice", label: "Цена продажи, ₽/шт.", hint: <p>Выручка ÷ проданные штуки (средневзвешенно).</p>, fmt: (m) => money(m.avgPrice) },
  { key: "avgPriceEur", label: "Цена продажи, €/шт.", hint: <p>Выручка в евро ÷ проданные штуки (средневзвешенно).</p>, fmt: (m) => eur(m.avgPriceEur) },
  { key: "priceBefore", label: "Цена до скидки, ₽/шт.", hint: <p>Розница до скидки ÷ проданные штуки (средневзвешенно).</p>, fmt: (m) => money(m.priceBefore) },
  { key: "listPrice", label: "Прайс, ₽/шт.", hint: <p>Цена прайса 19.10.2026, средняя по проданным штукам.</p>, fmt: (m) => money(m.listPrice) },
  { key: "priceToList", label: "К прайсу, %", hint: <p>Выручка с НДС ÷ (штуки × прайс) − 1.</p>, fmt: (m) => spct(m.priceToList) },
  { key: "unitCost", label: "Себестоимость", money: true, hint: <p>Себестоимость единицы из ТЗ (с работой) по проданным единицам, где она есть.</p>, fmt: (m) => money(m.unitCost) },
  { key: "markupW", label: "Наценка", hint: <p>Средневзвешенный по приходу: Σ(розница × шт.) ÷ Σ(себестоимость с НДС × шт.).</p>, fmt: (m) => x2(m.markupW) },
  { key: "grossProfit", label: "Валовая прибыль", money: true, hint: <p>Выручка − себестоимость проданного по строкам со штуками и себестоимостью.</p>, fmt: (m) => money(m.grossProfit) },
  { key: "grossMarginPct", label: "Маржа, %", hint: <p>Валовая прибыль ÷ выручка тех же строк.</p>, fmt: (m) => pct(m.grossMarginPct === null ? null : m.grossMarginPct / 100, 1) },
  { key: "coverMonths", label: "Покрытие, мес.", totalOnly: true, hint: <p>Остаток ÷ средние продажи в месяц (с первого месяца продаж до последнего месяца данных). Считается только при положительном остатке и продажах.</p>, fmt: (m) => d1(m.coverMonths) },
  { key: "firstReceipt", label: "Первая поставка", totalOnly: true, hint: <p>Дата первой строки прихода.</p>, fmt: (m) => dateRu(m.firstReceipt) },
  { key: "lastSale", label: "Последняя продажа", totalOnly: true, hint: <p>Дата последней строки продажи.</p>, fmt: (m) => dateRu(m.lastSale) },
];
const eur = (v: number | null) => (v === null || Math.abs(v) < 0.5 ? DASH : Math.round(v).toLocaleString("ru-RU") + " €");
const DEF_TOTAL: MKey[] = ["conf", "received", "sold", "stock", "revenue", "revenueEur", "grossRev", "discountSum", "discountGiven", "avgPrice"];
const DEF_NARROW: MKey[] = ["sold", "stock", "revenue"];

const th = "px-2 text-right text-xs font-semibold whitespace-nowrap";
const td = "px-2 py-1.5 text-right text-sm tabular-nums whitespace-nowrap";

function Columns({ measures, keys, onKey, levels, onLevel, onCollapse }: { measures: { key: MKey; label: string }[]; keys: MKey[]; onKey: (k: MKey) => void; levels: [number, string][]; onLevel: (l: number) => void; onCollapse: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("mousedown", onDown); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={btn}>Колонки ▾</button>
      {open && (
        <div role="group" aria-label="Колонки и уровни таблицы" className="absolute left-0 z-30 mt-1 flex max-h-[70vh] w-72 max-w-[85vw] flex-col gap-3 overflow-y-auto rounded-lg border border-neutral-300 bg-white p-3 shadow-lg">
          <div>
            <p className="mb-1 text-xs font-semibold">Меры</p>
            <ul className="flex flex-col">
              {measures.map((m) => <li key={m.key}><label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={keys.includes(m.key)} onChange={() => onKey(m.key)} />{m.label}</label></li>)}
            </ul>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold">Развернуть до уровня</p>
            <div className="flex flex-wrap gap-1">
              {levels.map(([l, t]) => <button key={l} type="button" onClick={() => onLevel(l)} className={btn}>{t}</button>)}
              <button type="button" onClick={onCollapse} className={btn}>Свернуть</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export type TreeProps = {
  input: MarginInputS; lines: SLine[]; env: Env; vat: "ex" | "in"; cat: Cat; sizes: ReportSizeRow[]; photos: PhotoIdx;
  struct: Struct; onStruct: (s: Struct) => void;
  picked: MKey[] | null; onPicked: (k: MKey[]) => void; filtersNote: string;
};

export function SalesTree({ input, lines, env, vat, cat, sizes, photos, struct, onStruct, picked, onPicked, filtersNote }: TreeProps) {
  const [open, setOpen] = useState<string[]>([]);
  const narrow = useSyncExternalStore(
    (cb) => { const mq = window.matchMedia("(max-width: 639px)"); mq.addEventListener("change", cb); return () => mq.removeEventListener("change", cb); },
    () => window.matchMedia("(max-width: 639px)").matches,
    () => false,
  );
  const keys = picked ?? (narrow ? DEF_NARROW : DEF_TOTAL);
  const ctx: Ctx = useMemo(() => makeCtx(deserializeInput(input), vat), [input, vat]);

  const view = useMemo(() => {
    const seasons = sortSeasons(lines.map((l) => l.season));
    const groups = seasons.map((s) => ({ head: s, pred: (l: SLine) => l.season === s }));
    const preds = groups.map((g) => g.pred);
    const order = STRUCTS.find((s) => s.key === struct)!.order;
    const src = lines;
    const top = buildSalesTree(ctx, env, src, order, preds);
    return { groups, order, tree: totalSalesNode(ctx, env, lines, preds, top) };
  }, [ctx, env, lines, struct]);

  const { groups, tree, order } = view;
  const confRows = sizes.filter((r) => cat === "all" || r.cls === cat);
  const hasConf = confRows.some((r) => (r.conf ?? 0) > 0);
  const available = MEASURES.filter((m) => m.key !== "conf" || hasConf);
  const measures = available.filter((m) => keys.includes(m.key));
  const msOf = (gi: number) => measures.filter((ms) => gi === 0 || !ms.totalOnly);
  const setKey = (k: MKey) => onPicked(keys.includes(k) ? (keys.length > 1 ? keys.filter((x) => x !== k) : keys) : [...keys, k]);
  const toggle = (id: string) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  const kids = (n: SNode): SNode[] => (n.children.length ? n.children : sizeNodes(n, sizes, cat, groups.length, vat));
  const expandTo = (level: number) => {
    const ids: string[] = [];
    const walk = (n: SNode, depth: number) => { const k = kids(n); if (depth < level && k.length) { ids.push(n.id); k.forEach((c) => walk(c, depth + 1)); } };
    walk(tree, 0);
    setOpen(ids);
  };
  // Заказано по узлу: строки отчёта с тем же Кат.1 / Кат.2 / мехом / артикулом / цветом, что в пути узла (/cls:…/fur:…/article:…/color:…).
  const fabricByArt = useMemo(() => { const m: Record<string, string> = {}; for (const l of lines) if (l.fabric && !m[l.article]) { m[l.article] = l.fabric; m[articleKey(l.article)] = l.fabric; } return m; }, [lines]);
  const rowKey = (r: ReportSizeRow, d: string) => d === "cls" ? r.cls : d === "c2" ? (r.l4 || r.l3 || "Без категории").trim() : d === "fur" ? furKeyOfRow(r, fabricByArt) : d === "article" ? r.acode : d === "color" ? colorOfLine(r.color) : "";
  const seasonKey = (s: string) => ({ "FW25/26": "FW25/26", SS2026: "SS26", "FW26/27": "FW26/27" } as Record<string, string>)[s.replace(/\s+/g, "")] ?? s.replace(/\s+/g, "");
  const confOf = (n: SNode, gi: number, recv = 0) => {
    if (!hasConf || n.dim === "size") return DASH;
    const segs = n.id === "total" ? [] : n.id.split(/\/(?=(?:cls|c2|fur|article|color|size):)/).filter(Boolean).map((s) => [s.slice(0, s.indexOf(":")), s.slice(s.indexOf(":") + 1)] as const);
    const rs = confRows.filter((r) => segs.every(([d, k]) => (d === "article" ? articleKey(r.acode) === articleKey(k) : rowKey(r, d) === k)));
    const season = gi > 0 ? seasonKey(groups[gi - 1]?.head ?? "") : null;
    const confOfSeason = (sk: string) => rs.reduce((a, r) => a + (r.seas?.[sk]?.conf ?? 0), 0);
    // «Всего» = сумма колонок сезонов (закрытые — по приходу файла, FW26 — заказ отчёта), а не Conf отчёта целиком (876): иначе «Всего» ≠ 292 + 61 + 509.
    if (!season) {
      const tot = groups.reduce((a, g, i) => a + (seasonKey(g.head ?? "") === "FW26/27" ? confOfSeason("FW26/27") : n.cols[i + 1]?.received ?? 0), 0);
      return tot ? n0(tot) : DASH;
    }
    const v = season === "FW26/27" ? confOfSeason(season) : 0;
    // Закрытые сезоны (SS26, FW25): заказано = получено по файлу прихода (как в таблице «Сезоны»); FW26 — заказ отчёта.
    const closed = season !== null && season !== "FW26/27";
    const out = closed ? recv : v;
    return out ? n0(out) : DASH;
  };
  const cell = (ms: Measure, n: SNode, m: Ext, gi: number) => {
    if (ms.totalOnly && gi > 0) return DASH;
    if (ms.key === "conf") return confOf(n, gi, m.received);
    if (n.dim === "size" && !["received", "sold", "revenue", "avgPrice", "stock", "sellThrough"].includes(ms.key)) return DASH;
    if (m.sold === 0 && m.received === 0 && m.discountSum === 0) return DASH;
    return ms.fmt(m);
  };

  const exportCsv = () => {
    // В CSV — числа (не «368 127 401 ₽» и не «5,9 %»): единица измерения в заголовке, пустое — пусто; даты и текст остаются текстом.
    const PCT_KEYS: MKey[] = ["discountGiven", "sellThrough", "priceToList", "grossMarginPct"];
    const unit = (ms: Measure) => (ms.money ? (ms.eur ? ", €" : ", ₽") : PCT_KEYS.includes(ms.key) ? ", %" : "");
    const csvCell = (t: string): string => {
      const v = t.trim();
      if (v === "" || v === DASH || v === "–" || v === "–") return "";
      const m = /^([−-]?)\s*([\d\s\u00a0\u202f]+(?:[,.]\d+)?)\s*(?:₽|€|%|шт\.?)?$/.exec(v);
      return m ? (m[1] ? "-" : "") + m[2].replace(/[\s\u00a0\u202f]/g, "") : v;
    };
    const head = ["Уровень", "Позиция", ...(["Всего", ...groups.map((g) => g.head)].flatMap((h, gi) => measures.filter((ms) => gi === 0 || !ms.totalOnly).map((ms) => `${h}: ${ms.label}${unit(ms)}`)))];
    const rows: (string | number | null)[][] = [];
    walkTree(tree, (n, depth) => {
      rows.push([depth === 0 ? "Всего" : SDIM_LABEL[n.dim], n.label, ...n.cols.flatMap((m, gi) => measures.filter((ms) => gi === 0 || !ms.totalOnly).map((ms) => csvCell(cell(ms, n, m, gi))))]);
    });
    const blob = new Blob([toCsv(head, rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "prodazhi-i-ostatki.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /** Сортировка по клику на подпись показателя: порядок строк среди соседей одного уровня (повторный клик — обратный, третий снимает). */
  const [colSort, setColSort] = useState<{ gi: number; key: string; dir: "asc" | "desc" } | null>(null);
  const clickSort = (gi: number, key: string) => setColSort((c) => (c && c.gi === gi && c.key === key ? (c.dir === "asc" ? { gi, key, dir: "desc" } : null) : { gi, key, dir: "asc" }));
  const sortVal = (n: SNode): number => {
    if (!colSort) return 0;
    const m = n.cols[colSort.gi];
    if (colSort.key === "conf") { const t = confOf(n, colSort.gi, m?.received ?? 0).replace(/[\s\u00a0]/g, ""); const v = Number(t); return Number.isFinite(v) ? v : -1; }
    const v = (m as unknown as Record<string, unknown> | undefined)?.[colSort.key];
    return typeof v === "number" && Number.isFinite(v) ? v : -1;
  };
  const sortKids = (ns: SNode[]): SNode[] => (colSort ? [...ns].sort((x, y) => (colSort.dir === "desc" ? -1 : 1) * (sortVal(x) - sortVal(y)) || x.label.localeCompare(y.label, "ru", { numeric: true })) : ns);
  const renderNode = (n: SNode, depth: number): React.ReactNode => {
    const isTotal = n.id === "total";
    const isOpen = isTotal || open.includes(n.id);
    const k = sortKids(kids(n));
    const hasPhoto = !isTotal && n.modelCode && (n.dim === "article" || n.dim === "color");
    const photo = hasPhoto ? photos[n.modelCode!] : undefined;
    const vphotos = photo && n.variant ? photo.photos.filter((p) => p.variant.trim().toUpperCase() === n.variant!.trim().toUpperCase()) : [];
    const bg = isTotal ? "bg-neutral-100" : "bg-white";
    const href = !isTotal && (n.dim === "article" || n.dim === "color") ? movementHref(n.article, n.dim === "color" ? n.color : null, n.modelCode) : null;
    return (
      <Fragment key={n.id}>
        <tr className={"border-b border-neutral-200 " + (isTotal ? "bg-neutral-100 font-semibold" : "")}>
          <td className={"sticky left-0 z-[1] w-12 min-w-12 px-1 py-1 text-center align-middle " + bg}>
            {hasPhoto ? (photo && vphotos.length > 0 ? <PhotoGalleryButton modelId={photo.modelId} photos={vphotos} title={n.label} compact thumbOnly /> : <span role="img" aria-label="Фото нет" className="mx-auto inline-block size-10 rounded border border-dashed border-neutral-300" />) : null}
          </td>
          <th scope="row" className={"sticky left-12 z-[1] h-14 w-40 min-w-40 max-w-40 px-1 py-1 text-left text-sm sm:w-64 sm:min-w-64 sm:max-w-64 " + (isTotal ? "font-semibold " : "font-normal ") + bg} style={{ paddingLeft: 4 + depth * 12 }}>
            <span className="flex items-center gap-1">
              {!isTotal && k.length > 0 ? (
                <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Развернуть"}: ${n.label}`} onClick={() => toggle(n.id)} className="inline-flex min-h-11 min-w-9 shrink-0 items-center justify-center rounded-md">{isOpen ? "▾" : "▸"}</button>
              ) : <span aria-hidden className="inline-block w-9 shrink-0" />}
              <span className="min-w-0 flex-1" title={n.label}>
                {href ? <Link href={href} className="block min-h-11 truncate leading-[2.75rem] underline decoration-neutral-400 underline-offset-2 hover:decoration-neutral-900" title={`${n.label} — движение по артикулу`}>{n.label}</Link> : <span className="block truncate">{n.label}</span>}
              </span>
            </span>
          </th>
          {n.cols.map((m, gi) => msOf(gi).map((ms) => <td key={gi + ms.key} className={td + (gi === 0 ? " border-r border-neutral-200 font-semibold" : "")}>{cell(ms, n, m, gi)}</td>))}
        </tr>
        {isOpen && k.map((c) => renderNode(c, depth + 1))}
      </Fragment>
    );
  };

  const heads = ["Всего", ...groups.map((g) => g.head)];
  const orderTitle = order.map((d) => SDIM_LABEL[d]).join(" → ");
  return (
    <section aria-label="Таблица детализации" className="flex min-w-0 scroll-mt-16 flex-col gap-3 rounded-lg border border-neutral-300 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Детализация</h2>
        <p className="text-xs text-neutral-700">{filtersNote}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <div role="group" aria-label="Структура" className={segGroup}>
          {STRUCTS.map((s) => <button key={s.key} type="button" aria-pressed={struct === s.key} title={s.label} onClick={() => { onStruct(s.key); setOpen([]); }} className={seg(struct === s.key)}>{STRUCT_SHORT[s.key]}</button>)}
        </div>
        <Columns measures={available} keys={keys} onKey={setKey} levels={order.map((d, i) => [i + 1, SDIM_LABEL[d]] as [number, string])} onLevel={expandTo} onCollapse={() => setOpen([])} />
        <button type="button" onClick={exportCsv} className={btn}>Скачать CSV</button>
        <InfoHint label="Структуры и уровни" wide><p>Уровни: {orderTitle}. Итог узла равен сумме детей; размеры — по Report (дата отчёта указана над таблицей), в итог не входят.</p></InfoHint>
      </div>
      <div className="max-h-[75vh] w-full min-w-0 max-w-full overflow-auto rounded-lg border border-neutral-300" tabIndex={0} role="region" aria-label="Детализация продаж и остатков по структуре и группам столбцов">
        <table suppressHydrationWarning className="table-keep w-max min-w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-300">
              <th scope="col" rowSpan={2} className={th + " sticky left-0 top-0 z-[3] w-12 min-w-12 bg-white text-center"}>Фото</th>
              <th scope="col" rowSpan={2} className={th + " sticky left-12 top-0 z-[3] w-40 min-w-40 max-w-40 bg-white text-left sm:w-64 sm:min-w-64 sm:max-w-64"}><span className="block truncate" title={orderTitle}>{orderTitle}</span></th>
              {heads.map((h, gi) => <th key={h} scope="colgroup" colSpan={msOf(gi).length || 1} className={"sticky top-0 z-[2] h-9 bg-white px-2 text-center text-xs font-semibold " + (gi === 0 ? "border-r border-neutral-200" : "border-l border-neutral-200")}>{h}</th>)}
            </tr>
            <tr className="border-b border-neutral-300">
              {heads.map((h, gi) => msOf(gi).map((ms) => (
                <th key={h + ms.key} scope="col" aria-sort={colSort && colSort.gi === gi && colSort.key === ms.key ? (colSort.dir === "asc" ? "ascending" : "descending") : undefined} className={th + " sticky top-9 z-[2] h-9 bg-white font-normal text-neutral-700"}>
                  <button type="button" onClick={() => clickSort(gi, ms.key)} aria-label={`Сортировать: ${h}, ${ms.label}`} className="hover:underline max-md:min-h-11">
                    {ms.label}{ms.money ? (ms.eur ? ", €" : ", ₽") : ""}<span aria-hidden className="inline-block w-2.5 text-[10px] text-[color:var(--ui-accent)]">{colSort && colSort.gi === gi && colSort.key === ms.key ? (colSort.dir === "asc" ? "▲" : "▼") : ""}</span>
                  </button>
                  {gi === 0 ? <InfoHint label={`Как считается: ${ms.label}`} wide>{ms.hint}</InfoHint> : null}
                </th>
              )))}
            </tr>
          </thead>
          <tbody>{renderNode(tree, 0)}</tbody>
        </table>
      </div>
    </section>
  );
}

