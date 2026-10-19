"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import { PhotoGalleryButton } from "@/components/photo-gallery";
import { buildMargin, deserializeInput, type FullLine, type MarginInputS } from "@/lib/margin";
import { buildTreeBy, makeCtx, sellNote, sizeAgg, totalNode, TREE_ORDER, type Metrics, type ReportSizeRow, type TreeNode } from "@/lib/margin-tree";

type Cat = "all" | "clothes" | "acc";
type PhotoIdx = Record<string, { modelId: string; photos: { id: string; variant: string; color?: string; itemId?: string }[] }>;
type MKey = "sold" | "received" | "revenueEx" | "sellThrough" | "avgPrice" | "discountVsRetail" | "discountGiven" | "grossProfit" | "grossMarginPct" | "gpOfRetail" | "markupW";

const nodata = "—";
const money = (v: number | null) => (v === null ? nodata : formatMoney(v));
const x2 = (v: number | null) => (v === null ? nodata : "×" + v.toFixed(2).replace(".", ","));
const pc = (v: number | null, d = 0) => (v === null ? nodata : v.toLocaleString("ru-RU", { maximumFractionDigits: d, minimumFractionDigits: d }) + " %");
const share = (v: number | null) => (v === null ? null : v * 100);
/** Сезон словом: SS — лето, FW — осень–зима. */
const seasonHead = (s: string) => `${s} · ${/^SS/i.test(s) ? "лето" : "осень–зима"}`;
const MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const monthHead = (m: string) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

type Measure = { key: MKey; label: string; hint: React.ReactNode; fmt: (m: Metrics) => string };
const MEASURES: Measure[] = [
  { key: "sold", label: "Продано, шт.", hint: <p>Чистые продажи в штуках (возвраты минус).</p>, fmt: (m) => String(m.sold) },
  { key: "received", label: "Получено, шт.", hint: <p>Поступившие единицы по заказам группы (корректировки с минусом учтены).</p>, fmt: (m) => String(m.received) },
  { key: "revenueEx", label: "Выручка без НДС", hint: <p>Net Sales: розничные продажи без НДС после скидок (Retail RUR без НДС из выгрузки), возвраты минус.</p>, fmt: (m) => money(m.revenueEx) },
  { key: "sellThrough", label: "Sell-through", hint: <><p>Продано ÷ получено, единицы (по заказам группы; в «Тотал» — за всё время). Без обрезки до 100%; получено 0 — «—».</p><p className="mt-1">«*» — продано больше получено: продажи включают остатки других поступлений. «†» — получено меньше 10 шт., процент неустойчив. Для проверки: всего продано 232, получено 617, остаток 385 (по отчёту о товарах 379).</p></>, fmt: (m) => (m.received > 0 ? pc(share(m.sellThrough)) + (sellNote(m) === "over" ? "*" : sellNote(m) === "small" ? "†" : "") : nodata) },
  { key: "avgPrice", label: "Средняя цена", hint: <p>Выручка с НДС (Retail RUR после скидки) ÷ проданные единицы.</p>, fmt: (m) => money(m.avgPrice) },
  { key: "discountVsRetail", label: "Скидка от прайса", hint: <p>Отклонение реальной цены продажи от нынешнего прайса: 1 − фактическая выручка с НДС (Retail RUR после скидки) ÷ (штуки × текущая цена из прайса 19.10.2026), по проданным позициям, у которых цена нашлась. Это НЕ столбец Discount из файла.</p>, fmt: (m) => pc(share(m.discountVsRetail), 1) },
  { key: "discountGiven", label: "Скидка при продаже", hint: <p>Фактически предоставленная скидка от цены до скидки: Discount RUR ÷ (Retail RUR + Discount RUR) по строкам продаж, с НДС (столбец Discount из файла продаж).</p>, fmt: (m) => pc(share(m.discountGiven), 1) },
  { key: "grossProfit", label: "Вал. прибыль", hint: <p>Net Sales − себестоимость: выручка без НДС (после скидки) минус себестоимость проданных единиц без НДС (себестоимость модели из ТЗ с работой × проданные штуки). Только там, где есть себестоимость.</p>, fmt: (m) => money(m.grossProfit) },
  { key: "grossMarginPct", label: "Вал. маржа", hint: <p>Валовая прибыль (Net Sales − себестоимость) ÷ Net Sales.</p>, fmt: (m) => pc(m.grossMarginPct, 1) },
  { key: "gpOfRetail", label: "Прибыль / розница", hint: <p>Валовая прибыль ÷ розничная стоимость проданного без НДС (штуки × текущая розница ÷ 1,22), по позициям с ценой и себестоимостью.</p>, fmt: (m) => pc(share(m.gpOfRetail), 1) },
  { key: "markupW", label: "Маркап прихода", hint: <p>Средневзвешенный по единицам прихода: Σ(розница × шт.) ÷ Σ(себестоимость с НДС × шт.). Розница — текущий прайс, себестоимость — из ТЗ.</p>, fmt: (m) => x2(m.markupW) },
];
const DEFAULT_KEYS: MKey[] = ["sold", "revenueEx", "sellThrough", "discountVsRetail", "grossMarginPct"];
const NARROW_KEYS: MKey[] = ["sold", "revenueEx"];
const LEVELS: [number, string][] = [[1, "Категории"], [2, "Тип меха"], [3, "Артикулы"], [4, "Цвета"]];

function Tile({ label, value, sub, hint }: { label: string; value: string; sub?: string; hint: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-neutral-300 bg-white p-3">
      <div className="flex items-center gap-1 text-xs text-neutral-600">{label}<InfoHint label={`Как считается: ${label}`} wide>{hint}</InfoHint></div>
      <div className="text-lg font-semibold tabular-nums text-neutral-900">{value}</div>
      {sub ? <div className="text-xs text-neutral-600">{sub}</div> : null}
    </div>
  );
}

const th = "px-2 text-right text-xs font-semibold whitespace-nowrap";
const td = "px-2 py-1.5 text-right text-sm tabular-nums whitespace-nowrap";

export function MarginBlock({ input, cat, shown, onChange, sizes, photos }: { input: MarginInputS | null; cat: Cat; shown: string; onChange: () => void; sizes: ReportSizeRow[]; photos: PhotoIdx }) {
  const [mode, setMode] = useState<"seasons" | "months">("seasons");
  const [keys, setKeys] = useState<MKey[]>(DEFAULT_KEYS);
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState<string[]>([]);
  const [showSizes, setShowSizes] = useState(false);
  // На узком экране набор мер по умолчанию меньше (штуки, выручка); выбранное вручную не трогаем.
  useEffect(() => {
    if (touched) return;
    const mq = window.matchMedia("(max-width: 639px)");
    const apply = () => setKeys(mq.matches ? NARROW_KEYS : DEFAULT_KEYS);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [touched]);

  const inp = useMemo(() => (input ? deserializeInput(input) : null), [input]);
  const view = useMemo(() => {
    if (!inp) return null;
    const lines = cat === "all" ? inp.lines : inp.lines.filter((l) => l.cls === cat);
    const ctx = makeCtx(inp);
    const rank = (s: string) => { const m = /(\d{2,4})/.exec(s); const y = m ? (Number(m[1]) < 100 ? 2000 + Number(m[1]) : Number(m[1])) : 0; return y + (/^SS/i.test(s) ? 0.2 : 0.7); };
    const seasons = [...new Set(lines.map((l) => l.season))].sort((a, b) => rank(a) - rank(b));
    const months = [...new Set(lines.map((l) => l.iso.slice(0, 7)))].sort();
    const groups: { head: string; pred: (l: FullLine) => boolean }[] = mode === "seasons"
      ? seasons.map((s) => ({ head: seasonHead(s), pred: (l) => l.season === s }))
      : months.map((m) => ({ head: monthHead(m), pred: (l) => l.iso.startsWith(m) }));
    const preds = groups.map((g) => g.pred);
    const top = buildTreeBy(ctx, lines, TREE_ORDER, preds);
    return { groups, tree: totalNode(ctx, lines, preds, top), data: buildMargin(inp, cat) };
  }, [inp, cat, mode]);
  const sizeRows = useMemo(() => sizeAgg(sizes, (r) => cat === "all" || r.cls === cat), [sizes, cat]);

  if (!view || !input) {
    return (
      <section aria-label="Маржа и наценка" className="rounded-lg border border-neutral-300 bg-white p-3">
        <h2 className="text-sm font-semibold">Маржа и наценка</h2>
        <p className="mt-1 text-sm text-neutral-700">Нет данных о продажах: выгрузка поступлений и продаж ещё не загружена.</p>
      </section>
    );
  }
  const { data, groups, tree } = view;
  const cov = (v: number | null) => (v === null ? "нет данных" : Math.round(v * 100) + " %");
  const measures = MEASURES.filter((m) => keys.includes(m.key));
  const setKey = (k: MKey) => { setTouched(true); setKeys((cur) => (cur.includes(k) ? (cur.length > 1 ? cur.filter((x) => x !== k) : cur) : [...cur, k])); };
  const toggle = (id: string) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  const expandTo = (level: number) => {
    const ids: string[] = [];
    const walk = (n: TreeNode, depth: number) => { if (depth < level && n.children.length) { ids.push(n.id); n.children.forEach((c) => walk(c, depth + 1)); } };
    walk(tree, 0);
    setOpen(ids);
  };

  const renderNode = (n: TreeNode, depth: number): React.ReactNode => {
    const isTotal = n.id === "total";
    const isOpen = isTotal || open.includes(n.id);
    const photo = !isTotal && n.modelCode && (n.dim === "article" || n.dim === "color") ? photos[n.modelCode] : undefined;
    const vphotos = photo && n.variant ? photo.photos.filter((p) => p.variant.trim().toUpperCase() === n.variant!.trim().toUpperCase()) : [];
    const bg = isTotal ? "bg-neutral-100" : "bg-white";
    return (
      <Fragment key={n.id}>
        <tr className={"border-b border-neutral-200 " + (isTotal ? "bg-neutral-100 font-semibold" : "")}>
          <td className={"sticky left-0 z-[1] w-14 min-w-14 px-1 py-1 text-center align-middle " + bg}>
            {!isTotal && (n.dim === "article" || n.dim === "color") ? (
              photo && vphotos.length > 0 ? <PhotoGalleryButton modelId={photo.modelId} photos={vphotos} title={n.label} compact thumbOnly /> : <span role="img" aria-label="Фото нет" className="mx-auto inline-block size-11 rounded border border-dashed border-neutral-300" />
            ) : null}
          </td>
          <th scope="row" className={"sticky left-14 z-[1] h-14 px-2 py-1 text-left text-sm " + (isTotal ? "font-semibold " : "font-normal ") + bg} style={{ paddingLeft: 8 + depth * 16 }}>
            <span className="flex items-center gap-2">
              {!isTotal && n.children.length ? (
                <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Развернуть"}: ${n.label}`} onClick={() => toggle(n.id)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md">{isOpen ? "▾" : "▸"}</button>
              ) : <span aria-hidden className="inline-block w-11" />}
              <span className="min-w-0 break-words">{n.label}</span>
            </span>
          </th>
          {n.cols.map((m, gi) => measures.map((ms) => <td key={gi + ms.key} className={td + (gi === 0 ? " border-r border-neutral-200 font-semibold" : "")}>{m.sold === 0 && m.received === 0 ? "—" : ms.fmt(m)}</td>))}
        </tr>
        {isOpen && n.children.map((c) => renderNode(c, depth + 1))}
      </Fragment>
    );
  };

  const seg = (on: boolean) => "inline-flex min-h-11 items-center rounded-md px-3 text-sm " + (on ? "bg-neutral-900 text-white" : "text-neutral-700 hover:text-neutral-900");
  const heads = ["Тотал", ...groups.map((g) => g.head)];
  return (
    <section aria-label="Маржа и наценка" className="flex min-w-0 scroll-mt-16 flex-col gap-3 rounded-lg border border-neutral-300 bg-white p-3">
      <h2 className="text-sm font-semibold">Маржа и наценка</h2>
      <p className="flex flex-wrap items-center gap-2 text-xs text-neutral-700 print:hidden"><span>Показано: {shown}</span><button type="button" onClick={onChange} className="inline-flex min-h-11 items-center rounded-md px-2 underline">Изменить</button></p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="Средний маркап" value={x2(data.avgMarkup)} sub={`простой по ${data.avgMarkupN} моделям`} hint={<p>Маркап модели = текущая розница с НДС ÷ себестоимость единицы с работой и НДС (как «Себестоимость» в «Изделиях»). Здесь — простое среднее по моделям, у которых есть и цена, и себестоимость. Наценка в % = (маркап − 1) × 100.</p>} />
        <Tile label="По приходу" value={x2(data.weightedByReceipts)} sub="вес — единицы прихода" hint={<p>Средневзвешенный маркап: Σ(розница × единицы прихода) ÷ Σ(себестоимость × единицы прихода).</p>} />
        <Tile label="По продажам" value={x2(data.weightedBySales)} sub="вес — проданные единицы" hint={<p>Σ(розница × проданные единицы) ÷ Σ(себестоимость × проданные единицы). Возвраты минус.</p>} />
        <Tile label="Валовая маржа" value={pc(data.totals.grossMarginPct, 1)} sub={data.totals.grossProfit === null ? undefined : `${formatMoney(data.totals.grossProfit)} без НДС`}
          hint={<><p>Валовая прибыль = Net Sales − себестоимость проданных единиц без НДС. Маржа = прибыль ÷ Net Sales.</p><p className="mt-1">Охват данных: себестоимость нашлась у {cov(data.costCoverage)} проданных единиц, текущая розница из прайса — у {cov(data.priceCoverage)}. Остальное в расчёты не входит.</p></>} />
      </div>

      <div className="flex flex-col gap-2 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-700">Столбцы:</span>
          <div role="group" aria-label="Столбцы" className="inline-flex rounded-lg border border-neutral-300 bg-white p-0.5">
            <button type="button" aria-pressed={mode === "seasons"} onClick={() => setMode("seasons")} className={seg(mode === "seasons")}>Сезоны</button>
            <button type="button" aria-pressed={mode === "months"} onClick={() => setMode("months")} className={seg(mode === "months")}>Месяцы</button>
          </div>
          <span className="ml-2 text-xs text-neutral-700">Развернуть до уровня:</span>
          <div role="group" aria-label="Уровень" className="inline-flex flex-wrap rounded-lg border border-neutral-300 bg-white p-0.5">
            {LEVELS.map(([l, t]) => <button key={l} type="button" onClick={() => expandTo(l)} className={seg(false)}>{t}</button>)}
            <button type="button" onClick={() => setOpen([])} className={seg(false)}>Свернуть</button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-neutral-700">Меры:</span>
          {MEASURES.map((m) => (
            <button key={m.key} type="button" aria-pressed={keys.includes(m.key)} onClick={() => setKey(m.key)}
              className={"inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-xs " + (keys.includes(m.key) ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700")}>
              <span aria-hidden>{keys.includes(m.key) ? "✓" : "+"}</span>{m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[75vh] w-full min-w-0 max-w-full overflow-auto rounded-lg border border-neutral-300" tabIndex={0} role="region" aria-label="Маржа: иерархия и меры по группам столбцов">
        <table className="w-max min-w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-300">
              <th scope="col" rowSpan={2} className={th + " sticky left-0 top-0 z-[3] w-14 min-w-14 bg-white text-center"}>Фото</th>
              <th scope="col" rowSpan={2} className={th + " sticky left-14 top-0 z-[3] min-w-[14rem] bg-white text-left"}>Категория → тип меха → артикул → цвет</th>
              {heads.map((h, gi) => <th key={h} scope="colgroup" colSpan={measures.length} className={"sticky top-0 z-[2] h-9 bg-white px-2 text-center text-xs font-semibold " + (gi === 0 ? "border-r border-neutral-200" : "border-l border-neutral-200")}>{h}</th>)}
            </tr>
            <tr className="border-b border-neutral-300">
              {heads.map((h, gi) => measures.map((ms) => (
                <th key={h + ms.key} scope="col" className={th + " sticky top-9 z-[2] h-9 bg-white font-normal text-neutral-700"}>
                  {ms.label}{gi === 0 ? <InfoHint label={`Как считается: ${ms.label}`} wide>{ms.hint}</InfoHint> : null}
                </th>
              )))}
            </tr>
          </thead>
          <tbody>{renderNode(tree, 0)}</tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-700">* продано больше получено: продажи включают остатки других поступлений. † получено меньше 10 шт., процент неустойчив.</p>

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
                  <td className={td}>{r.received}</td><td className={td}>{r.sold}</td><td className={td}>{r.stock}</td>
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
