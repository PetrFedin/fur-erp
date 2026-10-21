"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { formatMoney } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import Link from "next/link";
import { SEG_GROUP, Segmented, segCls } from "@/components/segmented";
import { PhotoGalleryButton } from "@/components/photo-gallery";
import { buildMargin, deserializeInput, type FullLine, type MarginInputS } from "@/lib/margin";
import { colorOfLine } from "@/lib/sales-receipts-core";
import { buildTreeBy, DIM_LABEL, makeCtx, sellNote, sizeAgg, totalNode, TREE_ORDERS, type Metrics, type ReportSizeRow, type TreeNode } from "@/lib/margin-tree";

type Cat = "all" | "clothes" | "acc";
type PhotoIdx = Record<string, { modelId: string; photos: { id: string; variant: string; color?: string; itemId?: string }[] }>;
type MKey = "conf" | "received" | "salesCost" | "sold" | "revenueEx" | "discountSum" | "discountGiven" | "grossProfit" | "grossMarginPct" | "stock" | "sellThrough" | "avgPrice" | "discountVsRetail" | "gpOfRetail" | "markupW" | "gross" | "grossUnit" | "listPrice" | "toList";

const nodata = "—";
const money = (v: number | null) => (v === null || Math.abs(v) < 0.5 ? nodata : formatMoney(v));
const n0 = (v: number) => (v === 0 ? nodata : String(v));
const x2 = (v: number | null) => (v === null ? nodata : "×" + v.toFixed(2).replace(".", ","));
const pc = (v: number | null, d = 0) => (v === null || v === 0 ? nodata : v.toLocaleString("ru-RU", { maximumFractionDigits: d, minimumFractionDigits: d }) + " %");
const share = (v: number | null) => (v === null ? null : v * 100);
/** Сезон словом: SS — лето, FW — осень–зима. */
const seasonHead = (s: string) => `${s} · ${/^SS/i.test(s) ? "лето" : "осень–зима"}`;
const MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const monthHead = (m: string) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

type Cur = "rub" | "eur";
const eur = (v: number | null) => (v === null || Math.abs(v) < 0.5 ? nodata : Math.round(v).toLocaleString("ru-RU") + " €");
/** money — мера в деньгах (подпись ₽/€ в шапке); rubOnly — только в рублях (себестоимость ТЗ в ₽, курс не задан). */
type Measure = { key: MKey; label: string; hint: React.ReactNode; fmt: (m: Metrics, cur: Cur, vat?: "ex" | "in") => string; money?: boolean; rubOnly?: boolean };
const signed = (v: number | null, d = 1) => (v === null ? nodata : (v > 0 ? "+" : "") + v.toLocaleString("ru-RU", { maximumFractionDigits: d, minimumFractionDigits: d }) + " %");
/** Порядок мер как в отчёте о товарах (лист Report): Conf → Delivery → Sales cost (SC) → Sales PCS → Sales retail (NS) → Discount → маржа; затем дополнительные меры. */
const MEASURES: Measure[] = [
  { key: "conf", label: "Conf, шт.", hint: <p>Conf (TTL Conf PCS в отчёте): подтверждено заказов, шт. Есть только в «Тотал» и для категорий (в отчёте нет дат и сезонов выгрузки; по артикулам написания разные), в остальных строках «—».</p>, fmt: () => nodata },
  { key: "received", label: "Получено, шт.", hint: <p>Delivery (TTL Delivery PCS): получено единиц по заказам группы, корректировки с минусом учтены.</p>, fmt: (m, _c) => n0(m.received) },
  { key: "salesCost", money: true, rubOnly: true, label: "Себестоимость продаж", hint: <p>Sales cost (SC): себестоимость проданных единиц без НДС = себестоимость модели из ТЗ с работой × проданные штуки; только строки со штуками, где есть себестоимость. (В отчёте SC — в евро по стандартной себестоимости; здесь — наша себестоимость в рублях.)</p>, fmt: (m, _c) => money(m.salesCost) },
  { key: "sold", label: "Продано, шт.", hint: <p>Sales PCS: проданные единицы, возвраты минус.</p>, fmt: (m, _c) => n0(m.sold) },
  { key: "revenueEx", money: true, label: "Выручка", hint: <p>Выручка (Net sales) = Retail RUR файла продаж после скидки, в выбранном режиме НДС; возвраты минус.</p>, fmt: (m, c) => (c === "eur" ? eur(m.revenueEur) : money(m.revenue)) },
  { key: "gross", money: true, label: "Gross", hint: <p>Gross (розница до скидки) = Выручка + Скидка.</p>, fmt: (m, c) => (c === "eur" ? eur(m.revenueEur + m.discountEurSum) : money(m.revenue + m.discountSum)) },
  { key: "discountSum", money: true, label: "Скидка", hint: <p>Скидка = Discount RUR файла продаж.</p>, fmt: (m, c) => (c === "eur" ? eur(m.discountEurSum) : money(m.discountSum)) },
  { key: "discountGiven", label: "Скидка, %", hint: <p>Скидка % = Скидка ÷ Gross.</p>, fmt: (m, _c) => pc(share(m.discountGiven), 1) },
  { key: "grossProfit", rubOnly: true, label: "Маржа, ₽", hint: <p>Валовая прибыль = Net Sales − себестоимость (Sales retail − Sales cost) по строкам со штуками и себестоимостью.</p>, fmt: (m, _c) => money(m.grossProfit) },
  { key: "grossMarginPct", rubOnly: true, label: "Маржа, %", hint: <p>Валовая прибыль ÷ Net Sales тех же строк (строки продаж без штук в расчёт не входят — выручка по ним показана отдельно в «i» плитки «Валовая маржа»).</p>, fmt: (m, _c) => pc(m.grossMarginPct, 1) },
  { key: "stock", label: "Остаток, шт.", hint: <p>Остаток группы = Delivery − Sales pcs. По отчёту о товарам фактический остаток на 19.10.2026 — 379 шт., расчётный 385.</p>, fmt: (m, _c) => n0(m.received - m.sold) },
  { key: "sellThrough", label: "Sell-through", hint: <><p>Продано ÷ получено, единицы (по заказам группы; в «Тотал» — за всё время). Без обрезки до 100%; получено 0 — «—».</p><p className="mt-1">«*» — продано больше получено: продажи включают остатки других поступлений. «†» — получено меньше 10 шт., процент неустойчив.</p></>, fmt: (m, _c) => (m.received > 0 ? pc(share(m.sellThrough)) + (sellNote(m) === "over" ? "*" : sellNote(m) === "small" ? "†" : "") : nodata) },
  { key: "grossUnit", money: true, label: "Цена до скидки, за шт.", hint: <p>Цена до скидки = Gross ÷ проданные шт.</p>, fmt: (m, c) => (m.sold > 0 ? (c === "eur" ? eur((m.revenueEur + m.discountEurSum) / m.sold) : money((m.revenue + m.discountSum) / m.sold)) : nodata) },
  { key: "avgPrice", money: true, label: "Цена продажи, за шт.", hint: <p>Цена продажи = Выручка ÷ проданные шт.</p>, fmt: (m, c) => (c === "eur" ? eur(m.avgPriceEur) : money(m.avgPrice)) },
  { key: "discountVsRetail", rubOnly: true, label: "Цена к прайсу 19.10", hint: <p>Реальная цена продажи к нынешнему прайсу: выручка с НДС ÷ (штуки × текущая цена из прайса 19.10.2026) − 1. Отрицательное — продано дешевле прайса, положительное — дороже (в основном рост цен). Это не скидка: настоящая скидка — Discount.</p>, fmt: (m, _c) => signed(m.discountVsRetail === null ? null : -m.discountVsRetail * 100) },
  { key: "gpOfRetail", rubOnly: true, label: "Прибыль / розница", hint: <p>Валовая прибыль ÷ розничная стоимость проданного без НДС (штуки × текущая розница ÷ (1 + ставка НДС на дату продажи: 20% до 12.2025, 22% с 01.2026)), по позициям с ценой и себестоимостью.</p>, fmt: (m, _c) => pc(share(m.gpOfRetail), 1) },
  { key: "markupW", rubOnly: true, label: "Маркап прихода", hint: <p>Средневзвешенный по единицам прихода: Σ(розница × шт.) ÷ Σ(себестоимость с НДС × шт.). Розница — текущий прайс, себестоимость — из ТЗ. Некоторые модели помечены (см. строки): у них маркап искажён данными ТЗ или ценой.</p>, fmt: (m, _c) => x2(m.markupW) },
  { key: "listPrice", money: true, rubOnly: true, label: "Прайс 19.10, за шт.", hint: <p>Справочная цена прайс-листа 19.10.2026, средневзвешенная по штукам.</p>, fmt: (m, _c) => money(m.listPrice ?? null) },
  { key: "toList", rubOnly: true, label: "К прайсу, %", hint: <p>К прайсу % = Выручка ÷ (цена прайса × проданные шт.).</p>, fmt: (m, _c) => pc(m.toListPct ?? null, 0) },
];
const TOTAL_KEYS: MKey[] = ["sold", "revenueEx", "gross", "discountSum", "discountGiven", "avgPrice", "grossMarginPct"];
const GROUP_KEYS: MKey[] = ["sold", "revenueEx", "discountGiven", "avgPrice", "grossMarginPct"];
const NARROW_KEYS: MKey[] = ["sold", "revenueEx"];
/** Пометки по моделям (независимая проверка 19.10.2026): артефакты расчёта маркапа. */
const MODEL_NOTES: Record<string, string> = {
  MH07: "в ТЗ нет меха: маркап завышен", MCF01: "в ТЗ нет меха: маркап завышен",
  MSC01: "усреднённая себестоимость (смесь норки и соболя)", MSC02: "усреднённая себестоимость; маркап считан по единицам с ценой 4 815 000, продавался по 1,4–1,9 млн",
  MSC03: "усреднённая себестоимость (смесь)", M012: "усреднённая себестоимость (смесь)", MGL01: "усреднённая себестоимость (смесь)", MH16: "усреднённая себестоимость (смесь)",
};

function Tile({ label, value, sub, hint }: { label: string; value: string; sub?: string; hint: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-neutral-300 bg-white p-3">
      <div className="flex items-center gap-1 text-xs text-neutral-600">{label}<InfoHint label={`Как считается: ${label}`} wide>{hint}</InfoHint></div>
      <div className="text-lg font-semibold tabular-nums text-neutral-900">{value}</div>
      {sub ? <div className="text-xs text-neutral-600">{sub}</div> : null}
    </div>
  );
}

/** Выпадающая панель «Настройки»: меры (чекбоксы) и «Развернуть до уровня»; закрывается по Esc и клику снаружи. */
function Settings({ measures, keys, onKey, levels, onLevel, onCollapse }: { measures: { key: MKey; label: string }[]; keys: MKey[]; onKey: (k: MKey) => void; levels: [number, string][]; onLevel: (l: number) => void; onCollapse: () => void }) {
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
  const btn = "inline-flex min-h-11 items-center rounded-md border border-neutral-300 bg-white px-3 text-sm hover:bg-neutral-50";
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={btn}>Колонки ▾</button>
      {open && (
        <div role="group" aria-label="Колонки таблицы" className="absolute left-0 z-30 mt-1 flex w-72 max-w-[85vw] flex-col gap-3 rounded-lg border border-neutral-300 bg-white p-3 shadow-lg">
          <div>
            <p className="mb-1 text-xs font-semibold">Колонки</p>
            <ul className="flex flex-col">
              {measures.map((m) => (
                <li key={m.key}><label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={keys.includes(m.key)} onChange={() => onKey(m.key)} />{m.label}</label></li>
              ))}
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

const th = "px-2 text-right text-xs font-semibold whitespace-nowrap";
const td = "px-2 py-1.5 text-right text-sm tabular-nums whitespace-nowrap";

export function MarginBlock({ input, cat, shown, onChange, sizes, photos, tree: treeKey, onTree, cur, onCur, vat, onVat }: { cur: Cur; onCur: (c: Cur) => void; vat: "ex" | "in"; onVat: (v: "ex" | "in") => void; input: MarginInputS | null; cat: Cat; shown: string; onChange: () => void; sizes: ReportSizeRow[]; photos: PhotoIdx; tree: "a" | "b"; onTree: (t: "a" | "b") => void }) {
  const [mode, setMode] = useState<"total" | "seasons" | "months">("total");
  const [picked, setPicked] = useState<MKey[]>(TOTAL_KEYS);
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState<string[]>([]);
  const [showSizes, setShowSizes] = useState(false);
  // На узком экране набор мер по умолчанию меньше (штуки и выручка); выбранное вручную не трогаем.
  const narrow = useSyncExternalStore(
    (cb) => { const mq = window.matchMedia("(max-width: 639px)"); mq.addEventListener("change", cb); return () => mq.removeEventListener("change", cb); },
    () => window.matchMedia("(max-width: 639px)").matches,
    () => false,
  );
  const keys = touched ? picked : narrow ? NARROW_KEYS : mode === "total" ? TOTAL_KEYS : GROUP_KEYS;

  const inp = useMemo(() => (input ? deserializeInput(input) : null), [input]);
  const view = useMemo(() => {
    if (!inp) return null;
    const lines = cat === "all" ? inp.lines : inp.lines.filter((l) => l.cls === cat);
    const ctx = makeCtx(inp, vat);
    const rank = (s: string) => { const m = /(\d{2,4})/.exec(s); const y = m ? (Number(m[1]) < 100 ? 2000 + Number(m[1]) : Number(m[1])) : 0; return y + (/^SS/i.test(s) ? 0.2 : 0.7); };
    const seasons = [...new Set(lines.map((l) => l.season))].sort((a, b) => rank(a) - rank(b));
    const months = [...new Set(lines.map((l) => l.iso.slice(0, 7)))].sort();
    const groups: { head: string; pred: (l: FullLine) => boolean }[] = mode === "total" ? [] : mode === "seasons"
      ? seasons.map((s) => ({ head: seasonHead(s), pred: (l) => l.season === s }))
      : months.map((m) => ({ head: monthHead(m), pred: (l) => l.iso.startsWith(m) }));
    const preds = groups.map((g) => g.pred);
    const order = TREE_ORDERS[treeKey];
    const top = buildTreeBy(ctx, lines, order, preds);
    const count = (f: (l: FullLine) => string) => new Set(lines.map(f)).size;
    return { groups, order, tree: totalNode(ctx, lines, preds, top), data: buildMargin(inp, cat), n1: count((l) => l.cls), n2: count((l) => (l.level4 ?? l.level3 ?? "—")), n3: count((l) => (l.fabric ?? "").toUpperCase().split(/[\s+/]/)[0]) };
  }, [inp, cat, mode, treeKey, vat]);
  const sizeRows = useMemo(() => sizeAgg(sizes, (r) => cat === "all" || r.cls === cat), [sizes, cat]);

  if (!view || !input) {
    return (
      <section aria-label="Маржа и наценка" className="rounded-lg border border-neutral-300 bg-white p-3">
        <h2 className="text-sm font-semibold">Маржа и наценка</h2>
        <p className="mt-1 text-sm text-neutral-700">Нет данных о продажах: выгрузка поступлений и продаж ещё не загружена.</p>
      </section>
    );
  }
  const { data, groups, tree, order } = view;
  const cov = (v: number | null) => (v === null ? "нет данных" : Math.round(v * 100) + " %");
  const confRows = sizes.filter((r) => cat === "all" || r.cls === cat);
  const hasConf = confRows.some((r) => (r.conf ?? 0) > 0);
  // Conf показываем, только если он есть в данных (отчёт о товарах загружен).
  const available = MEASURES.filter((m) => (m.key !== "conf" || hasConf) && !(cur === "eur" && m.rubOnly));
  const measures = available.filter((m) => keys.includes(m.key));
  const setKey = (k: MKey) => { setTouched(true); setPicked(keys.includes(k) ? (keys.length > 1 ? keys.filter((x) => x !== k) : keys) : [...keys, k]); };
  const toggle = (id: string) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  /** Размеры как дочерний уровень цвета: из отчёта о товарах на 19.10 по коду модели и цвету; итоги размеров не обязаны совпадать с узлом (написания артикулов разные). */
  const sizeKids = (n: TreeNode): TreeNode[] => {
    if (n.dim !== "color" || !n.modelCode) return [];
    const rows = sizes.filter((r) => r.modelCode === n.modelCode && colorOfLine(r.color) === n.label && (cat === "all" || r.cls === cat));
    return rows.map((r) => {
      const empty = { sold: 0, received: 0, revenueIncl: 0, revenueEx: 0, avgPrice: null, discountVsRetail: null, grossProfit: null, grossMarginPct: null, gpOfRetail: null, markupW: null, sellThrough: null, discountGiven: null, salesCost: null, discountSum: 0 } as Metrics;
      const m: Metrics = { ...empty, sold: r.sold, received: r.deliv, revenueEx: r.nsRubEx, revenueIncl: r.nsRub, avgPrice: r.sold > 0 ? r.nsRub / r.sold : null, sellThrough: r.deliv > 0 ? r.sold / r.deliv : null };
      return { id: `${n.id}/size:${r.size}:${r.acode}`, dim: "size" as const, label: `${r.size} · по Report 19.10`, modelCode: null, variant: null, cols: [m, ...groups.map(() => empty)], children: [] };
    });
  };
  const hasKids = (n: TreeNode) => n.children.length > 0 || sizeKids(n).length > 0;
  const expandTo = (level: number) => {
    const ids: string[] = [];
    const walk = (n: TreeNode, depth: number) => { const kids = n.children.length ? n.children : sizeKids(n); if (depth < level && kids.length) { ids.push(n.id); kids.forEach((c) => walk(c, depth + 1)); } };
    walk(tree, 0);
    setOpen(ids);
  };

  /** Conf из отчёта: только строка «Всего» и категории (сопоставимо по Level 02 отчёта). */
  const confOf = (n: TreeNode) => (!hasConf ? nodata : n.id === "total" ? String(confRows.reduce((a, r) => a + (r.conf ?? 0), 0)) : n.dim === "cls" && n.id.split("/").length === 2 ? String(confRows.filter((r) => r.cls === (n.label === "Одежда" ? "clothes" : n.label === "Аксессуары" ? "acc" : "other")).reduce((a, r) => a + (r.conf ?? 0), 0)) : nodata);

  const renderNode = (n: TreeNode, depth: number): React.ReactNode => {
    const isTotal = n.id === "total";
    const isOpen = isTotal || open.includes(n.id);
    const photo = !isTotal && n.modelCode && (n.dim === "article" || n.dim === "color") ? photos[n.modelCode] : undefined;
    const vphotos = photo && n.variant ? photo.photos.filter((p) => p.variant.trim().toUpperCase() === n.variant!.trim().toUpperCase()) : [];
    const bg = isTotal ? "bg-neutral-100" : "bg-white";
    const note = !isTotal && n.modelCode && (n.dim === "article" || n.dim === "color") ? MODEL_NOTES[n.modelCode] : undefined;
    return (
      <Fragment key={n.id}>
        <tr className={"border-b border-neutral-200 " + (isTotal ? "bg-neutral-100 font-semibold" : "")}>
          <td className={"sticky left-0 z-[1] w-12 min-w-12 px-1 py-1 text-center align-middle " + bg}>
            {!isTotal && (n.dim === "article" || n.dim === "color") ? (
              photo && vphotos.length > 0 ? <PhotoGalleryButton modelId={photo.modelId} photos={vphotos} title={n.label} compact thumbOnly /> : <span role="img" aria-label="Фото нет" className="mx-auto inline-block size-10 rounded border border-dashed border-neutral-300" />
            ) : null}
          </td>
          <th scope="row" className={"sticky left-12 z-[1] h-14 w-40 min-w-40 max-w-40 px-1 py-1 text-left text-sm sm:w-60 sm:min-w-60 sm:max-w-60 " + (isTotal ? "font-semibold " : "font-normal ") + bg} style={{ paddingLeft: 4 + depth * 12 }}>
            <span className="flex items-center gap-1">
              {!isTotal && hasKids(n) ? (
                <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Развернуть"}: ${n.label}`} onClick={() => toggle(n.id)} className="inline-flex min-h-11 min-w-9 shrink-0 items-center justify-center rounded-md">{isOpen ? "▾" : "▸"}</button>
              ) : <span aria-hidden className="inline-block w-9 shrink-0" />}
              <span className="min-w-0 flex-1" title={n.label + (note ? " — " + note : "")}><span className="block truncate">{n.label}</span>{note ? <span className="block truncate text-xs font-normal text-neutral-600"><span aria-hidden>⚠ </span>{note}</span> : null}</span>
              {!isTotal && n.dim === "article" ? <Link href={`/sales/movement?a=${encodeURIComponent(n.label)}`} aria-label={`Продажи и остатки: ${n.label}`} title="Продажи и остатки по артикулу" className="inline-flex min-h-11 min-w-9 shrink-0 items-center justify-center rounded-md text-sm text-neutral-700 hover:text-neutral-900">↗</Link> : null}
            </span>
          </th>
          {n.cols.map((m, gi) => measures.map((ms) => <td key={gi + ms.key} className={td + (gi === 0 ? " border-r border-neutral-200 font-semibold" : "")}>{ms.key === "conf" ? (gi === 0 ? confOf(n) : nodata) : m.sold === 0 && m.received === 0 ? "—" : ms.fmt(m, cur, vat)}</td>))}
        </tr>
        {isOpen && (n.children.length ? n.children : sizeKids(n)).map((c) => renderNode(c, depth + 1))}
      </Fragment>
    );
  };

  const seg = (on: boolean) => segCls(on);
  const heads = ["Тотал", ...groups.map((g) => g.head)];
  return (
    <section aria-label="Маржа и наценка" className="flex min-w-0 scroll-mt-16 flex-col gap-3 rounded-lg border border-neutral-300 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Маржа и наценка</h2><Link href="/sales" className="inline-flex min-h-11 items-center text-sm underline">Подробнее: Продажи и остатки →</Link></div>
      <p className="flex flex-wrap items-center gap-2 text-xs text-neutral-700 print:hidden"><span>Показано: {shown}</span><span>Приход {view.tree.cols[0].received} шт. · продано {view.tree.cols[0].sold} шт.</span><Link href="/sales" className="inline-flex min-h-11 items-center underline">Продажи и остатки</Link><button type="button" onClick={onChange} className="inline-flex min-h-11 items-center rounded-md px-2 underline">Изменить</button></p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="Средний маркап" value={x2(data.avgMarkup)} sub={`простой по ${data.avgMarkupN} моделям`} hint={<p>Маркап модели = текущая розница с НДС ÷ себестоимость единицы с работой и НДС (как «Себестоимость» в «Изделиях»). Здесь — простое среднее по моделям, у которых есть и цена, и себестоимость. Наценка в % = (маркап − 1) × 100.</p>} />
        <Tile label="По приходу" value={x2(data.weightedByReceipts)} sub="вес — единицы прихода" hint={<p>Средневзвешенный маркап: Σ(розница × единицы прихода) ÷ Σ(себестоимость × единицы прихода).</p>} />
        <Tile label="По продажам" value={x2(data.weightedBySales)} sub="вес — проданные единицы" hint={<p>Σ(розница × проданные единицы) ÷ Σ(себестоимость × проданные единицы). Возвраты минус.</p>} />
        <Tile label="Валовая маржа" value={pc(data.totals.grossMarginPct, 1)} sub={data.totals.grossProfit === null ? undefined : `${formatMoney(data.totals.grossProfit)} без НДС`}
          hint={<><p>Валовая прибыль = Net Sales − себестоимость проданных единиц без НДС. Маржа = прибыль ÷ Net Sales строк со штуками и себестоимостью (без строк продаж без штук: {formatMoney(data.totals.excludedRevenueEx)} без НДС). К полной выручке маржа {pc(data.totals.marginFullPct, 1)}.</p><p className="mt-1">Охват данных: себестоимость нашлась у {cov(data.costCoverage)} проданных единиц, текущая розница из прайса — у {cov(data.priceCoverage)}. Остальное в расчёты не входит.</p></>} />
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <div role="group" aria-label="Столбцы" className={SEG_GROUP}>
          <button type="button" aria-pressed={mode === "total"} onClick={() => setMode("total")} className={seg(mode === "total")}>Тотал</button>
          <button type="button" aria-pressed={mode === "seasons"} onClick={() => setMode("seasons")} className={seg(mode === "seasons")}>Сезоны</button>
          <button type="button" aria-pressed={mode === "months"} onClick={() => setMode("months")} className={seg(mode === "months")}>Месяцы</button>
        </div>
        <Segmented label="Структура" items={[{ key: "a", label: "Категории → Мех", on: treeKey === "a", onSelect: () => onTree("a"), title: "Категория 1 → Категория 2 → Тип меха → Артикул → Цвет" }, { key: "b", label: "Мех → Категории", on: treeKey === "b", onSelect: () => onTree("b"), title: "Тип меха → Категория 1 → Категория 2 → Артикул → Цвет" }]} />
        <div role="group" aria-label="Валюта" className={SEG_GROUP}>
          <button type="button" aria-pressed={cur === "rub"} onClick={() => onCur("rub")} className={seg(cur === "rub")}>₽</button>
          <button type="button" aria-pressed={cur === "eur"} onClick={() => onCur("eur")} className={seg(cur === "eur")}>€</button>
        </div>
        <div role="group" aria-label="НДС" className={SEG_GROUP}>
          <button type="button" aria-pressed={vat === "in"} onClick={() => onVat("in")} className={seg(vat === "in")}>С НДС</button>
          <button type="button" aria-pressed={vat === "ex"} onClick={() => onVat("ex")} className={seg(vat === "ex")}>Без НДС</button>
        </div>
        <InfoHint label="Уровни структуры" wide><p>Категория 1 — KTT Level 02 файлов (Одежда / Аксессуары), {view.n1} шт. Категория 2 — Level 04 (Шубы, Куртки меховые, Шапка…; если Level 04 пуст — Level 03), {view.n2} шт. Тип меха — первое слово названия ткани, {view.n3} шт. Структура А: Категория 1 → Категория 2 → Тип меха → Артикул → Цвет → Размер; Б: Тип меха → Категория 1 → Категория 2 → Артикул → Цвет → Размер. Итог узла равен сумме детей. Размеры берутся из отчёта о товарах на 19.10 (по коду модели и цвету) и могут не сходиться с итогом цвета: написания артикулов в отчёте и выгрузке разные; такие строки помечены «по Report 19.10».</p></InfoHint>
        <Settings measures={available} keys={keys} onKey={setKey} levels={[...order.map((d, i) => [i + 1, DIM_LABEL[d]] as [number, string]), [order.length + 1, "Размер"]]} onLevel={expandTo} onCollapse={() => setOpen([])} />
      </div>

      <div className="max-h-[75vh] w-full min-w-0 max-w-full overflow-auto rounded-lg border border-neutral-300" tabIndex={0} role="region" aria-label="Маржа: иерархия и меры по группам столбцов">
        <table className="table-keep w-max min-w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-300">
              <th scope="col" rowSpan={2} className={th + " sticky left-0 top-0 z-[3] w-12 min-w-12 bg-white text-center"}>Фото</th>
              <th scope="col" rowSpan={2} className={th + " sticky left-12 top-0 z-[3] w-40 min-w-40 max-w-40 bg-white text-left sm:w-60 sm:min-w-60 sm:max-w-60"}><span className="block truncate" title={order.map((d) => DIM_LABEL[d]).join(" → ")}>{order.map((d) => DIM_LABEL[d]).join(" → ")}</span></th>
              {heads.map((h, gi) => <th key={h} scope="colgroup" colSpan={measures.length} className={"sticky top-0 z-[2] h-9 bg-white px-2 text-center text-xs font-semibold " + (gi === 0 ? "border-r border-neutral-200" : "border-l border-neutral-200")}>{h}</th>)}
            </tr>
            <tr className="border-b border-neutral-300">
              {heads.map((h, gi) => measures.map((ms) => (
                <th key={h + ms.key} scope="col" className={th + " sticky top-9 z-[2] h-9 bg-white font-normal text-neutral-700"}>
                  {ms.label}{ms.money ? `, ${cur === "eur" ? "€" : "₽"}` : ""}{gi === 0 ? <InfoHint label={`Как считается: ${ms.label}`} wide>{ms.hint}</InfoHint> : null}
                </th>
              )))}
            </tr>
          </thead>
          <tbody>{renderNode(tree, 0)}</tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-700">{cur === "eur" ? "€: выручка и скидка в евро берутся из выгрузки (Sales Retail EUR / Discount EUR, с НДС и без НДС по переключателю); себестоимость ТЗ в рублях и курс в данных не задан, поэтому себестоимость, маржа, маркап и цена к прайсу в € не показываются. " : `₽, ${vat === "ex" ? "без НДС" : "с НДС"}: выручка и скидка из выгрузки ${vat === "ex" ? "без НДС" : "с НДС"}, себестоимость ТЗ ${vat === "ex" ? "без НДС" : "с НДС"} (как «Себестоимость» в «Изделиях»). `}* продано больше получено: продажи включают остатки других поступлений. † получено меньше 10 шт., процент неустойчив.</p>

      <div>
        <button type="button" aria-expanded={showSizes} onClick={() => setShowSizes((v) => !v)} className="inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-3 text-sm">{showSizes ? "Скрыть размеры" : "Размеры (по отчёту о товарах)"}</button>
      </div>
      {showSizes && (
        <div className="w-full min-w-0 max-w-full overflow-x-auto rounded-lg border border-neutral-300" data-keep-scroll tabIndex={0} role="region" aria-label="Размеры">
          <table className="w-max min-w-full border-collapse">
            <caption className="px-2 py-2 text-left text-xs text-neutral-700">Отчёт о товарах на 19.10.2026: размеры нельзя привязать к цветам и сезонам выгрузки (написания артикулов разные), поэтому — отдельно.{sizeRows.length === 0 ? " Размеры ещё не загружены." : ""}</caption>
            <thead>
              <tr className="border-b border-neutral-300">
                <th scope="col" className={th + " py-2 text-left"}>Размер</th>
                <th scope="col" className={th + " py-2"}>Получено, шт.</th><th scope="col" className={th + " py-2"}>Продано, шт.</th><th scope="col" className={th + " py-2"}>Остаток, шт.</th>
                <th scope="col" className={th + " py-2"}>Sell-through</th><th scope="col" className={th + " py-2"}>Средняя цена</th><th scope="col" className={th + " py-2"}>Выручка без НДС</th>
              </tr>
            </thead>
            <tbody>
              {sizeRows.map((r) => (
                <tr key={r.size} className="border-b border-neutral-200">
                  <th scope="row" className="px-2 py-1.5 text-left text-sm font-normal">{r.size}</th>
                  <td className={td}>{n0(r.received)}</td><td className={td}>{n0(r.sold)}</td><td className={td}>{n0(r.stock)}</td>
                  <td className={td}>{pc(share(r.sellThrough))}</td><td className={td}>{money(r.avgPrice)}</td><td className={td}>{money(r.revenueEx)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
