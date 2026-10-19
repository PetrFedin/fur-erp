"use client";

import { Fragment, useMemo, useState } from "react";
import { formatMoney } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import { PhotoGalleryButton } from "@/components/photo-gallery";
import { buildMargin, deserializeInput, type MarginInputS } from "@/lib/margin";
import { buildTree, CUT_ORDER, makeCtx, metricsOf, seasonsOf, sizeAgg, type Cut, type Metrics, type MetricKey, type ReportSizeRow, type TreeNode } from "@/lib/margin-tree";

type Cat = "all" | "clothes" | "acc";
type PhotoIdx = Record<string, { modelId: string; photos: { id: string; variant: string; color?: string; itemId?: string }[] }>;
type CutKey = "seasons" | Cut | "size";

const CUTS: [CutKey, string][] = [["seasons", "Сезоны"], ["cls", "Категории"], ["fur", "Тип меха"], ["article", "Артикулы"], ["color", "Цвета"], ["size", "Размеры"]];
const METRICS: [MetricKey, string][] = [["revenueEx", "Выручка"], ["sold", "Продано, шт."], ["sellThrough", "Sell-through"], ["avgPrice", "Средняя цена"], ["discountVsRetail", "Скидка"], ["grossMarginPct", "Маржа"], ["markupW", "Маркап"]];

const nodata = "нет данных";
const money = (v: number | null) => (v === null ? nodata : formatMoney(v));
const x2 = (v: number | null) => (v === null ? nodata : "×" + v.toFixed(2).replace(".", ","));
const pc = (v: number | null, d = 0) => (v === null ? nodata : v.toLocaleString("ru-RU", { maximumFractionDigits: d, minimumFractionDigits: d }) + " %");
const share = (v: number | null) => (v === null ? null : v * 100);
/** Сезон словом: SS — лето, FW — осень–зима. */
const seasonHead = (s: string) => `${s} · ${/^SS/i.test(s) ? "лето" : "осень–зима"}`;

type Row = { key: MetricKey | "soldRec"; label: string; hint?: React.ReactNode; fmt: (m: Metrics) => string; val: (m: Metrics) => number | null; goodUp?: boolean; trend?: boolean };
const ROWS: Row[] = [
  { key: "revenueEx", label: "Выручка без НДС", fmt: (m) => money(m.revenueEx), val: (m) => m.revenueEx },
  { key: "soldRec", label: "Продано / получено, шт.", fmt: (m) => `${m.sold} / ${m.received}`, val: () => null },
  { key: "sellThrough", label: "Sell-through", hint: <p>Продано ÷ получено единиц (по заказам сезона; в «Тотал» — за всё время).</p>, fmt: (m) => pc(share(m.sellThrough)), val: (m) => share(m.sellThrough), goodUp: true, trend: true },
  { key: "avgPrice", label: "Средняя цена продажи", hint: <p>Выручка с НДС ÷ проданные единицы (возвраты минус).</p>, fmt: (m) => money(m.avgPrice), val: () => null },
  { key: "discountVsRetail", label: "Скидка от текущей розницы", hint: <p>1 − выручка с НДС ÷ (штуки × текущая розница из прайса) по проданным позициям, у которых цена нашлась.</p>, fmt: (m) => pc(share(m.discountVsRetail), 1), val: (m) => share(m.discountVsRetail), goodUp: false, trend: true },
  { key: "grossProfit", label: "Валовая прибыль", hint: <p>Выручка без НДС − себестоимость проданных единиц без НДС (себестоимость модели из ТЗ с работой × проданные штуки).</p>, fmt: (m) => money(m.grossProfit), val: () => null },
  { key: "grossMarginPct", label: "Валовая маржа", hint: <p>Валовая прибыль ÷ выручка без НДС по проданному, у чего есть себестоимость.</p>, fmt: (m) => pc(m.grossMarginPct, 1), val: (m) => m.grossMarginPct, goodUp: true, trend: true },
  { key: "gpOfRetail", label: "Прибыль / розница", hint: <p>Валовая прибыль ÷ розничная стоимость проданного без НДС (штуки × текущая розница ÷ 1,22), по позициям с ценой и себестоимостью.</p>, fmt: (m) => pc(share(m.gpOfRetail), 1), val: (m) => share(m.gpOfRetail), goodUp: true, trend: true },
  { key: "markupW", label: "Маркап прихода", hint: <p>Средневзвешенный по единицам прихода: Σ(розница × шт.) ÷ Σ(себестоимость с НДС × шт.). Розница — текущий прайс, себестоимость — из ТЗ.</p>, fmt: (m) => x2(m.markupW), val: (m) => m.markupW, goodUp: true, trend: true },
];
const cellOf = (k: MetricKey, m: Metrics) => (k === "sold" ? String(m.sold) : ROWS.find((r) => r.key === k)!.fmt(m));

function Tile({ label, value, sub, hint }: { label: string; value: string; sub?: string; hint: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-neutral-300 bg-white p-3">
      <div className="flex items-center gap-1 text-xs text-neutral-600">{label}<InfoHint label={`Как считается: ${label}`} wide>{hint}</InfoHint></div>
      <div className="text-lg font-semibold tabular-nums text-neutral-900">{value}</div>
      {sub ? <div className="text-xs text-neutral-600">{sub}</div> : null}
    </div>
  );
}

/** Компактная стрелка тренда к предыдущему сезону: цвет и aria-label, без числа. */
function Arrow({ cur, prev, goodUp }: { cur: number | null; prev: number | null | undefined; goodUp: boolean }) {
  if (cur === null || prev === null || prev === undefined || Math.abs(cur - prev) < 1e-9) return null;
  const up = cur > prev;
  return <span role="img" aria-label={up ? "выше, чем в предыдущем сезоне" : "ниже, чем в предыдущем сезоне"} className={"ml-1 text-xs " + (up === goodUp ? "text-[#17613c]" : "text-[#b4310b]")}>{up ? "▲" : "▼"}</span>;
}

const th = "px-2 py-2 text-right text-xs font-semibold whitespace-nowrap";
const td = "px-2 py-1.5 text-right text-sm tabular-nums whitespace-nowrap";

export function MarginBlock({ input, cat, shown, onChange, sizes, photos }: { input: MarginInputS | null; cat: Cat; shown: string; onChange: () => void; sizes: ReportSizeRow[]; photos: PhotoIdx }) {
  const [cut, setCut] = useState<CutKey>("seasons");
  const [metric, setMetric] = useState<MetricKey>("revenueEx");
  const [open, setOpen] = useState<string[]>([]);
  const inp = useMemo(() => (input ? deserializeInput(input) : null), [input]);
  const view = useMemo(() => {
    if (!inp) return null;
    const lines = cat === "all" ? inp.lines : inp.lines.filter((l) => l.cls === cat);
    const inpF = { ...inp, lines };
    const ctx = makeCtx(inp);
    const seasons = seasonsOf(lines);
    const data = buildMargin(inp, cat);
    return { lines, ctx, seasons, data, total: metricsOf(ctx, lines), perSeason: seasons.map((s) => metricsOf(ctx, lines.filter((l) => l.season === s))), inpF };
  }, [inp, cat]);
  const tree = useMemo(() => (view && cut !== "seasons" && cut !== "size" ? buildTree(view.ctx, view.lines, CUT_ORDER[cut], view.seasons) : []), [view, cut]);
  const sizeRows = useMemo(() => sizeAgg(sizes, (r) => cat === "all" || r.cls === cat), [sizes, cat]);

  if (!view || !input) {
    return (
      <section aria-label="Маржа и наценка" className="rounded-lg border border-neutral-300 bg-white p-3">
        <h2 className="text-sm font-semibold">Маржа и наценка</h2>
        <p className="mt-1 text-sm text-neutral-700">Нет данных о продажах: выгрузка поступлений и продаж ещё не загружена.</p>
      </section>
    );
  }
  const { data, seasons, total, perSeason } = view;
  const cols = [total, ...perSeason];
  const heads = ["Тотал", ...seasons.map(seasonHead)];
  const cov = (v: number | null) => (v === null ? nodata : Math.round(v * 100) + " %");

  const toggle = (id: string) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));
  const renderNode = (n: TreeNode, depth: number): React.ReactNode => {
    const isOpen = open.includes(n.id);
    const photo = n.modelCode && (n.dim === "article" || n.dim === "color") ? photos[n.modelCode] : undefined;
    const vphotos = photo && n.variant ? photo.photos.filter((p) => p.variant.trim().toUpperCase() === n.variant!.trim().toUpperCase()) : [];
    return (
      <Fragment key={n.id}>
        <tr className="border-b border-neutral-200">
          <th scope="row" className="sticky left-0 z-[1] bg-white px-2 py-1 text-left text-sm font-normal" style={{ paddingLeft: 8 + depth * 16 }}>
            <span className="flex items-center gap-2">
              {n.children.length ? (
                <button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Развернуть"}: ${n.label}`} onClick={() => toggle(n.id)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-left">{isOpen ? "▾" : "▸"}</button>
              ) : <span aria-hidden className="inline-block w-11" />}
              <span className="min-w-0 break-words">{n.label}</span>
              {photo && vphotos.length > 0 ? <PhotoGalleryButton modelId={photo.modelId} photos={vphotos} title={n.label} compact /> : n.dim === "article" ? <span className="text-xs text-neutral-600">Фото нет</span> : null}
            </span>
          </th>
          {n.cols.map((m, i) => <td key={i} className={td}>{m.sold === 0 && m.received === 0 ? "—" : cellOf(metric, m)}</td>)}
        </tr>
        {isOpen && n.children.map((c) => renderNode(c, depth + 1))}
      </Fragment>
    );
  };

  const seg = (on: boolean) => "inline-flex min-h-11 items-center rounded-md px-3 text-sm " + (on ? "bg-neutral-900 text-white" : "text-neutral-700 hover:text-neutral-900");
  return (
    <section aria-label="Маржа и наценка" className="flex min-w-0 scroll-mt-16 flex-col gap-3 rounded-lg border border-neutral-300 bg-white p-3">
      <h2 className="text-sm font-semibold">Маржа и наценка</h2>
      <p className="flex flex-wrap items-center gap-2 text-xs text-neutral-700 print:hidden"><span>Показано: {shown}</span><button type="button" onClick={onChange} className="inline-flex min-h-11 items-center rounded-md px-2 underline">Изменить</button></p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="Средний маркап" value={x2(data.avgMarkup)} sub={`простой по ${data.avgMarkupN} моделям`} hint={<p>Маркап модели = текущая розница с НДС ÷ себестоимость единицы с работой и НДС (как «Себестоимость» в «Изделиях»). Здесь — простое среднее по моделям, у которых есть и цена, и себестоимость. Наценка в % = (маркап − 1) × 100.</p>} />
        <Tile label="По приходу" value={x2(data.weightedByReceipts)} sub="вес — единицы прихода" hint={<p>Средневзвешенный маркап: Σ(розница × единицы прихода) ÷ Σ(себестоимость × единицы прихода).</p>} />
        <Tile label="По продажам" value={x2(data.weightedBySales)} sub="вес — проданные единицы" hint={<p>Σ(розница × проданные единицы) ÷ Σ(себестоимость × проданные единицы). Возвраты минус.</p>} />
        <Tile label="Валовая маржа" value={pc(data.totals.grossMarginPct, 1)} sub={data.totals.grossProfit === null ? undefined : `${formatMoney(data.totals.grossProfit)} без НДС`}
          hint={<><p>Валовая прибыль = выручка без НДС − себестоимость проданных единиц без НДС. Маржа = прибыль ÷ выручка без НДС.</p><p className="mt-1">Охват данных: себестоимость нашлась у {cov(data.costCoverage)} проданных единиц, текущая розница из прайса — у {cov(data.priceCoverage)}. Остальное в расчёты не входит.</p></>} />
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <span className="text-xs text-neutral-700">Разрез:</span>
        <div role="group" aria-label="Разрез" className="inline-flex flex-wrap rounded-lg border border-neutral-300 bg-white p-0.5">
          {CUTS.map(([k, t]) => <button key={k} type="button" aria-pressed={cut === k} onClick={() => setCut(k)} className={seg(cut === k)}>{t}</button>)}
        </div>
      </div>

      {cut === "seasons" && (
        <div className="w-full min-w-0 max-w-full overflow-x-auto rounded-lg border border-neutral-300" data-keep-scroll tabIndex={0} role="region" aria-label="Маржа по сезонам">
          <table className="w-max min-w-full border-collapse">
            <thead>
              <tr className="border-b border-neutral-300">
                <th scope="col" className={th + " sticky left-0 z-[1] bg-white text-left"}>Показатель</th>
                {heads.map((h) => <th key={h} scope="col" className={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.key} className="border-b border-neutral-200">
                  <th scope="row" className="sticky left-0 z-[1] bg-white px-2 py-1.5 text-left text-sm font-normal">{r.label}{r.hint ? <InfoHint label={`Как считается: ${r.label}`} wide>{r.hint}</InfoHint> : null}</th>
                  {cols.map((m, i) => (
                    <td key={i} className={td + (i === 0 ? " font-semibold" : "")}>
                      {r.fmt(m)}
                      {r.trend && i >= 2 ? <Arrow cur={r.val(m)} prev={r.val(cols[i - 1])} goodUp={r.goodUp ?? true} /> : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cut !== "seasons" && cut !== "size" && (
        <>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <span className="text-xs text-neutral-700">Показатель:</span>
            <div role="group" aria-label="Показатель" className="inline-flex flex-wrap rounded-lg border border-neutral-300 bg-white p-0.5">
              {METRICS.map(([k, t]) => <button key={k} type="button" aria-pressed={metric === k} onClick={() => setMetric(k)} className={seg(metric === k)}>{t}</button>)}
            </div>
          </div>
          <div className="max-h-[70vh] w-full min-w-0 max-w-full overflow-auto rounded-lg border border-neutral-300" tabIndex={0} role="region" aria-label="Разрез по уровням">
            <table className="w-max min-w-full border-collapse">
              <thead>
                <tr className="border-b border-neutral-300">
                  <th scope="col" className={th + " sticky left-0 top-0 z-[2] bg-white text-left"}>{CUTS.find(([k]) => k === cut)![1]} — по клику раскрывается следующий уровень</th>
                  {heads.map((h) => <th key={h} scope="col" className={th + " sticky top-0 bg-white"}>{h}</th>)}
                </tr>
              </thead>
              <tbody>{tree.map((n) => renderNode(n, 0))}</tbody>
            </table>
          </div>
        </>
      )}

      {cut === "size" && (
        <div className="w-full min-w-0 max-w-full overflow-x-auto rounded-lg border border-neutral-300" data-keep-scroll tabIndex={0} role="region" aria-label="Размеры">
          <table className="w-max min-w-full border-collapse">
            <caption className="px-2 py-2 text-left text-xs text-neutral-700">По отчёту о товарах на 19.10.2026, без деления по сезонам.{sizeRows.length === 0 ? " Размеры ещё не загружены." : ""}</caption>
            <thead>
              <tr className="border-b border-neutral-300">
                <th scope="col" className={th + " text-left"}>Размер</th>
                <th scope="col" className={th}>Получено, шт.</th><th scope="col" className={th}>Продано, шт.</th><th scope="col" className={th}>Остаток, шт.</th>
                <th scope="col" className={th}>Sell-through</th><th scope="col" className={th}>Средняя цена</th><th scope="col" className={th}>Выручка без НДС</th>
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
