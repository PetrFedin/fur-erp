import Link from "next/link";
import { WidgetRow } from "@/components/widget-row";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { getYearFilter } from "@/lib/year-filter";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { c4Suffix } from "@/lib/commission4";
import { COMMISSION_RATE } from "@/lib/commission4-const";
import { buttonVariants } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Money } from "@/components/money";
import { InfoHint } from "@/components/info-hint";
import { TILE_BOX, TileHead, TileValue } from "@/app/(app)/dashboard/tile";
import { YearNote } from "@/components/year-note";
import { Mode4Badge } from "@/components/c4-note";
import { ResponsiveRows, RowCard } from "@/components/responsive-rows";
import { formatMoney, formatPercent, formatQty, formatShare } from "@/lib/utils";
import { loadOrderRows } from "@/lib/analytics-orders";
import {
  VIEW_LABEL,
  aggregatePricing,
  calcPrice,
  defaultMarkupPct,
  loadModelPrices,
  parsePricingCols,
  parsePricingParams,
  parsePricingSort,
  parseTargetMarkup,
  pricingParams,
  recommend,
  sortPricing,
  type PriceAgg,
  type PricingParams,
  type PricingView,
} from "@/lib/analytics-pricing";
import { applyShared, filterOptions } from "@/lib/analytics-filters";
import { COLUMNS, derived } from "@/lib/analytics-metrics";
import { weightedPercent } from "@/lib/weighted";
import { UNDEFINED_CATEGORY } from "@/lib/product-category";
import { AcceptPriceButton } from "./accept-price-button";
import { auctionLabeler } from "@/lib/filter-options";
import { AnalyticsFilterBar } from "../_shared/analytics-filter-bar";
import { MetricCell, MobileSort, SortTh, ViewBar, colLabel, pct0, q2, sortHref } from "../_shared/metric-ui";

export const metadata = { title: "Себестоимость и цены" };

const rub = (x: number) => formatMoney(x.toFixed(2));
const pct1 = (x: number) => formatPercent(x);
const orderLabel = (r: { workOrderNumber: string | null; number: string }) => r.number;

type Seg = { key: string; label: string; value: number; cls: string };

function segments(a: PriceAgg): Seg[] {
  return [
    { key: "fur", label: "Мех", value: a.furExcl, cls: "bg-emerald-600" },
    { key: "lin", label: "Подкладка", value: a.liningExcl, cls: "bg-sky-500" },
    { key: "c4", label: "4%", value: a.c4Excl, cls: "bg-amber-500" },
    { key: "vat", label: "НДС в материалах", value: a.vat, cls: "bg-neutral-400" },
    { key: "exp", label: "Расходы ТЗ", value: a.expenses, cls: "bg-violet-500" },
    { key: "work", label: "Работа", value: a.work, cls: "bg-rose-500" },
  ].filter((s) => s.value > 0.005);
}

function Bar({ a }: { a: PriceAgg }) {
  const segs = segments(a);
  const total = segs.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return <span className="text-neutral-500">—</span>;
  return (
    <div className="min-w-32">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-neutral-100" role="img" aria-label={segs.map((s) => `${s.label} ${formatShare(s.value / total)}`).join(", ")}>
        {segs.map((s) => (
          <span key={s.key} className={s.cls} style={{ width: `${(s.value / total) * 100}%` }} title={`${s.label}: ${formatShare(s.value / total)}`} />
        ))}
      </div>
      <div className="mt-0.5 text-[11px] leading-tight text-neutral-500">
        {segs.map((s) => `${s.label} ${formatShare(s.value / total)}`).join(" · ")}
      </div>
    </div>
  );
}

export default async function PricingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const year = await getYearFilter();
  const c4Mode = await getCommission4Mode();
  const c4 = c4Suffix(c4Mode);
  const sp = await searchParams;
  const p = parsePricingParams(sp);
  // Раскрытая карточка артикула: подробности (лоты, ТЗ, состав) строятся только для неё —
  // иначе страница весила ~8 МБ и считалась ~9 с.
  const openRaw = sp.open;
  const openKey = (Array.isArray(openRaw) ? openRaw[0] : openRaw) ?? "";
  const canEditPrice = hasRole(session.user.role, ACCESS.models);
  const orgId = session.user.organizationId;
  const cols = parsePricingCols(p.cols, p.all);
  const sortState = parsePricingSort(p.sort, p.dir);

  const [allYear, prices] = await Promise.all([loadOrderRows(orgId, year, c4Mode), loadModelPrices(orgId)]);
  const aucOf = await auctionLabeler(orgId);
  const opts = filterOptions(allYear);
  const all = applyShared(allYear, p);
  const models = aggregatePricing(all, "model", prices);
  const def = defaultMarkupPct(models, p.base);
  const defRounded = def.pct != null ? Math.round(def.pct) : null;
  const typed = parseTargetMarkup(p.m);
  const target = typed ?? defRounded;
  const badInput = p.m !== "" && typed == null;

  const listAll = p.view === "model" ? models : aggregatePricing(all, p.view, prices);
  const calcOf = (a: PriceAgg) => calcPrice(a, p.base, a.price);
  const issuesOf = (a: PriceAgg) => {
    const c = calcOf(a);
    const out: string[] = [];
    if (a.modelId && !a.price) out.push("завести цену");
    if (c.belowCost) out.push("цена ниже себестоимости");
    if (a.noUsages.length) out.push(`ТЗ без состава: ${a.noUsages.length}`);
    if (a.zeroCost.length) out.push(`себестоимость 0: ${a.zeroCost.length}`);
    if (a.noWork.length) out.push(`ТЗ без цены работы: ${a.noWork.length}`);
    if (a.label === UNDEFINED_CATEGORY) out.push("категория не определена");
    return out;
  };
  const filtered = listAll.filter((a) => (p.only === "noprice" ? a.modelId && !a.price : p.only === "issues" ? issuesOf(a).length > 0 : true));
  const shown = sortPricing(filtered, sortState.sort, sortState.dir, p.base, target);

  // Средняя наценка категории — по её ценообразованным моделям (вес — себестоимость партии).
  const catMarkup = new Map<string, { pct: number | null; priced: number; total: number }>();
  for (const a of models) {
    const cur = catMarkup.get(a.category) ?? { pct: null, priced: 0, total: 0 };
    cur.total += 1;
    if (a.price) cur.priced += 1;
    catMarkup.set(a.category, cur);
  }
  for (const [cat, v] of catMarkup) {
    const items = models
      .filter((a) => a.category === cat && a.price)
      .map((a) => {
        const c = calcOf(a);
        return c.markupPct != null && c.baseIncl ? { percent: c.markupPct, base: c.baseIncl * a.unitsCosted } : null;
      })
      .filter((x): x is { percent: number; base: number } => x !== null);
    v.pct = weightedPercent(items);
  }

  const modelsNoPrice = models.filter((a) => !a.price);
  const modelsBelow = models.filter((a) => calcOf(a).belowCost);
  const modelsNoUsages = models.filter((a) => a.noUsages.length > 0);
  const modelsZero = models.filter((a) => a.zeroCost.length > 0);
  const noWorkOrders = models.flatMap((a) => a.noWork);
  const inWorkNoCost = all.filter((r) => r.group === "work" && !(r.costIncl > 0));
  const pricedCount = models.filter((a) => a.price).length;
  const exampleModel = models.find((a) => a.price && calcOf(a).markupX && a.unitsCosted >= 3) ?? models.find((a) => a.price && calcOf(a).markupX);
  const exCalc = exampleModel ? calcOf(exampleModel) : null;

  const baseLabel = p.base === "full" ? "материалы + работа" : "материалы + расходы (как в «Изделиях»)";
  const basis = `наценка ${target ?? "—"}%, база — ${baseLabel}, ${c4Mode === "on" ? "с 4%" : "без 4%"}`;
  const qs = pricingParams(p).toString();
  const here = (over: Partial<PricingParams> = {}) => {
    const s = pricingParams(p, over).toString();
    return `/analytics/pricing${s ? `?${s}` : ""}`;
  };
  const sortOver = (o: { sort: string; dir: string }) => here({ sort: o.sort, dir: o.dir });
  const thHref = (key: string) => sortHref(sortOver, key, sortState);
  const openHref = (key: string, idx: number) => {
    const base = here();
    return `${base}${base.includes("?") ? "&" : "?"}open=${encodeURIComponent(key)}#row-${idx}`;
  };
  const closeHref = (idx: number) => `${here()}#row-${idx}`;
  // Подробности строки: только у раскрытой; у остальных — ссылка «Показать подробности».
  const lazyDetails = (a: PriceAgg, idx: number) =>
    a.key === openKey ? (
      <div>
        <Link href={closeHref(idx)} scroll={false} className="text-xs text-neutral-500 underline underline-offset-2">Свернуть подробности</Link>
        {details(a)}
      </div>
    ) : (
      <Link href={openHref(a.key, idx)} scroll={false} className="text-xs text-neutral-500 underline underline-offset-2">Показать подробности: сводка, состав, лоты, ТЗ</Link>
    );

  const perUnit = (a: PriceAgg, x: number) => (a.unitsCosted > 0 ? x / a.unitsCosted : 0);

  // Состав себестоимости единицы: «что входит».
  const composition = (a: PriceAgg) => {
    const u = (x: number) => perUnit(a, x);
    const full = a.costIncl + a.work;
    const share = (x: number) => (full > 0 ? pct1((x / full) * 100) : "—");
    const row = (label: React.ReactNode, incl: number, excl: number, shareBase: number, opts: { strong?: boolean; dim?: boolean } = {}) => (
      <Tr key={String(label)} className={opts.strong ? "bg-neutral-50 font-semibold" : opts.dim ? "text-neutral-500" : ""}>
        <Td>{label}</Td>
        <Td className="text-right tabular-nums"><Money incl={u(incl)} excl={u(excl)} /></Td>
        <Td className="text-right tabular-nums"><Money incl={incl} excl={excl} /></Td>
        <Td className="text-right tabular-nums">{share(shareBase)}</Td>
      </Tr>
    );
    const c4Excluded = a.c4PotIncl;
    return (
      <Table>
        <Thead>
          <Tr>
            <Th>Что входит</Th>
            <Th className="text-right" unit="₽">На единицу</Th>
            <Th className="text-right" unit="₽">Σ по ТЗ</Th>
            <Th className="text-right">Доля</Th>
          </Tr>
        </Thead>
        <Tbody>
          {row("Мех (по лотам, см. ниже)", a.furIncl, a.furExcl, a.furIncl)}
          {row("Подкладка", a.liningIncl, a.liningExcl, a.liningIncl)}
          {c4Mode === "on" ? (
            row(`4% на сырьё и подкладку`, a.c4Incl, a.c4Excl, a.c4Incl)
          ) : (
            <Tr className="text-neutral-500">
              <Td>4% — не включено (режим «Без 4%»)</Td>
              <Td className="text-right tabular-nums">+{rub(u(c4Excluded))}</Td>
              <Td className="text-right tabular-nums">+{rub(c4Excluded)}</Td>
              <Td className="text-right">—</Td>
            </Tr>
          )}
          {row("Расходы ТЗ", a.expenses, a.expenses, a.expenses)}
          {row(`Себестоимость системы${c4}`, a.costIncl, a.costExcl, a.costIncl, { strong: true })}
          {row("Работа (цена работы × кол-во)", a.work, a.work, a.work)}
          {row(`Полная себестоимость с работой${c4}`, a.costIncl + a.work, a.costExcl + a.work, full, { strong: true })}
        </Tbody>
      </Table>
    );
  };

  const lotsTable = (a: PriceAgg) =>
    a.lots.length === 0 ? (
      <p className="text-xs text-neutral-500">Нет списаний сырья — лоты неизвестны.</p>
    ) : (
      <Table>
        <Thead>
          <Tr>
            <Th>Лот</Th>
            <Th>Материал</Th>
            <Th className="text-right">Кол-во</Th>
            <Th className="text-right" unit="₽">Цена за ед.</Th>
            <Th className="text-right">
              Молоток за шкуру
              <InfoHint label="О молотке в лоте" align="right" wide>Цена шкуры на аукционе до сборов и выделки, в ₽ по курсу лота (в скобках — в долларах). «нет данных» — в расчёте лота молотка нет, лот в среднее молотка не входит.</InfoHint>
            </Th>
            <Th className="text-right" unit="₽">Сумма</Th>
            <Th className="text-right">ТЗ</Th>
          </Tr>
        </Thead>
        <Tbody>
          {a.lots.map((l) => (
            <Tr key={l.lotId}>
              <Td>
                <Link href={`/analytics/raw/lot/${l.lotId}`} className="underline underline-offset-2" title="Карточка лота: где использован, учёт, остаток">{l.lotNumber ?? "лот"}</Link>
                {(l.grade || l.color) && <span className="ml-1 text-xs text-neutral-500">{[l.grade, l.color].filter(Boolean).join(", ")}</span>}
                {l.purchaseId && (
                  <div className="text-[11px] text-neutral-500">
                    <Link href={`/purchases/${l.purchaseId}`} className="underline underline-offset-2">закупка {l.purchaseNumber}</Link>
                    {l.auction ? ` · ${l.auction}` : ""}
                  </div>
                )}
              </Td>
              <Td>{l.rawName}</Td>
              <Td className="text-right tabular-nums">{formatQty(l.qty)} {l.isLining ? "м" : "шк."}</Td>
              <Td className="text-right tabular-nums"><Money incl={l.qty > 0 ? l.incl / l.qty : 0} excl={l.qty > 0 ? l.excl / l.qty : 0} /></Td>
              <Td className="text-right tabular-nums">
                {l.isLining ? <span className="text-neutral-300">·</span> : l.hammerExcl != null ? (
                  <>
                    <Money incl={l.hammerIncl ?? l.hammerExcl} excl={l.hammerExcl} />
                    {l.hammerUsd != null && <span className="text-[11px] text-neutral-500"> (${formatQty(l.hammerUsd)})</span>}
                  </>
                ) : (
                  <span className="text-[11px] text-neutral-500">нет данных</span>
                )}
              </Td>
              <Td className="text-right tabular-nums"><Money incl={l.incl} excl={l.excl} /></Td>
              <Td className="text-right tabular-nums">{l.orders}</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    );

  const ordersList = (a: PriceAgg) => (
    <div className="flex flex-col gap-1 text-xs text-neutral-600">
      {[...a.rows]
        .sort((x, y) => x.number.localeCompare(y.number, "ru", { numeric: true }))
        .map((r) => (
          <div key={r.id} className="flex flex-wrap gap-x-2">
            <Link href={`/production/${r.id}`} className="font-medium text-neutral-800 underline underline-offset-2">ТЗ {orderLabel(r)}</Link>
            {!a.modelId && <span title={r.modelHint}>{r.modelLabel}</span>}
            <span>{formatQty(r.qty)} ед.</span>
            <span>{r.costIncl > 0 ? <><Money incl={r.costIncl / Math.max(r.qty, 1)} excl={r.costExcl / Math.max(r.qty, 1)} /> за ед.</> : "себестоимость 0"}</span>
            {r.furQty > 0 && <span>шкур {formatQty(r.furQty)}</span>}
            {r.batchNumber != null && <span>партия {r.batchNumber}</span>}
            {r.seasonCode && <span>сезон {r.seasonCode}</span>}
            {r.usageCount === 0 && <span className="text-amber-700">без состава</span>}
            {!(r.work > 0) && <span className="text-amber-700">без цены работы</span>}
          </div>
        ))}
    </div>
  );

  const breakdown = (a: PriceAgg, key: "year" | "season" | "batch") => {
    const m = new Map<string, number>();
    for (const r of a.rows) {
      const k = key === "year" ? (r.year == null ? "год не определён" : String(r.year)) : key === "season" ? (r.seasonCode ?? "сезон не указан") : r.batchNumber == null ? "без партии" : `партия ${r.batchNumber}`;
      m.set(k, (m.get(k) ?? 0) + r.qty);
    }
    return Array.from(m, ([k, v]) => `${k}: ${formatQty(v)}`).sort((x, y) => x.localeCompare(y, "ru", { numeric: true })).join(" · ");
  };

  // Карточка артикула: сводка по всем показателям и ссылки на ТЗ и лоты.
  const summary = (a: PriceAgg) => {
    const d = derived(a.m);
    const c = calcOf(a);
    const r = recommend(a, p.base, target);
    const dash = <span className="text-neutral-500">—</span>;
    const items: [string, React.ReactNode][] = [
      ["Произведено", <>{formatQty(a.units)} ед. · ТЗ {a.orders}{a.inWorkOrders ? ` (+${a.inWorkOrders} в работе)` : ""}</>],
      ["По годам", breakdown(a, "year") || dash],
      ["По сезонам", a.rows.some((x) => x.seasonCode) ? breakdown(a, "season") : <span className="text-neutral-500">сезон в ТЗ не указан</span>],
      ["По партиям", breakdown(a, "batch") || dash],
      ["Шкур на ед.", d.skinsPerUnit != null ? <>{q2(d.skinsPerUnit)} <span className="text-neutral-500">(Σ {formatQty(a.m.skins)})</span></> : dash],
      ["Подкладка, м на ед.", d.liningPerUnit != null ? <>{q2(d.liningPerUnit)} <span className="text-neutral-500">(Σ {q2(a.m.liningM)} м)</span></> : dash],
      [`Мех за ед.${c4}`, d.furPerUnit ? <Money incl={d.furPerUnit.incl} excl={d.furPerUnit.excl} /> : dash],
      [`Мех за шкуру${c4}`, d.furPerSkin ? <Money incl={d.furPerSkin.incl} excl={d.furPerSkin.excl} /> : dash],
      ["Молоток за шкуру", d.hammerPerSkin ? <><Money incl={d.hammerPerSkin.incl} excl={d.hammerPerSkin.excl} /> <span className="text-neutral-500">(данные: {pct0(d.hammerSkinShare ?? 0)} шкур, лотов {a.m.lotsHammer} из {a.m.lots})</span></> : <span className="text-neutral-500">нет данных (лотов {a.m.lots})</span>],
      ["Работа за ед.", d.workPerUnit != null ? formatMoney(d.workPerUnit.toFixed(2)) : dash],
      [`Себестоимость за ед.${c4}`, d.costPerUnit ? <><Money incl={d.costPerUnit.incl} excl={d.costPerUnit.excl} />{a.m.minCostIncl != null && a.m.maxCostIncl != null && a.costedOrders > 1 && <span className="text-neutral-500"> (от <Money incl={a.m.minCostIncl} excl={a.m.minCostExcl} /> до <Money incl={a.m.maxCostIncl} excl={a.m.maxCostExcl} />)</span>}</> : dash],
      [`Полная с работой${c4}`, d.fullPerUnit ? <><Money incl={d.fullPerUnit.incl} excl={d.fullPerUnit.excl} />{a.m.minFullIncl != null && a.m.maxFullIncl != null && a.costedOrders > 1 && <span className="text-neutral-500"> (от <Money incl={a.m.minFullIncl} excl={a.m.minFullExcl} /> до <Money incl={a.m.maxFullIncl} excl={a.m.maxFullExcl} />)</span>}</> : dash],
    ];
    if (a.modelId) {
      items.push(
        ["Цена", a.price ? formatMoney(a.price.toFixed(2)) : <span className="text-amber-700">не задана</span>],
        ["Наценка", c.markupX != null ? <>×{c.markupX.toFixed(2).replace(".", ",")} (+{formatPercent(c.markupPct ?? 0)}), маржа {pct1(c.marginPct ?? 0)}</> : dash],
        ["Рекомендуемая цена", r ? <><Money incl={r.incl} excl={r.excl} /> <span className="text-neutral-500">(при наценке {target}%, не факт)</span></> : dash],
      );
    }
    return (
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-lg border border-neutral-200 bg-neutral-50/50 p-3 text-xs sm:grid-cols-2">
        {items.map(([k, v]) => (
          <div key={k} className="flex flex-wrap gap-x-2">
            <dt className="text-neutral-500">{k}:</dt>
            <dd className="tabular-nums text-neutral-900">{v}</dd>
          </div>
        ))}
        {a.modelId && (
          <div className="sm:col-span-2">
            <Link href={`/models/${a.modelId}`} className="underline underline-offset-2">карточка модели</Link>
            {a.salesCode ? <span className="text-neutral-500"> · код продаж {a.salesCode}</span> : null}
          </div>
        )}
      </dl>
    );
  };

  const details = (a: PriceAgg) => (
    <div className="mt-2 flex flex-col gap-3 font-normal">
      <div>
        <div className="mb-1 text-xs font-medium text-neutral-700">{a.modelId ? "Карточка артикула" : "Сводка"}</div>
        {summary(a)}
      </div>
      {composition(a)}
      <div>
        <div className="mb-1 text-xs font-medium text-neutral-700">Из каких лотов (мех и подкладка)</div>
        {lotsTable(a)}
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-neutral-700">Завершённые ТЗ ({a.rows.length})</div>
        {ordersList(a)}
      </div>
    </div>
  );

  const rangeCell = (a: PriceAgg) =>
    a.minUnitIncl != null && a.maxUnitIncl != null && a.costedOrders > 1 ? (
      <div className="text-[11px] leading-tight text-neutral-500">
        от <Money incl={a.minUnitIncl} excl={a.minUnitExcl} /> до <Money incl={a.maxUnitIncl} excl={a.maxUnitExcl} />
        <br />
        по ТЗ ({a.costedOrders})
      </div>
    ) : null;

  const costCell = (a: PriceAgg) => {
    const c = calcOf(a);
    return c.baseIncl == null ? "—" : (
      <div>
        <Money incl={c.baseIncl} excl={c.baseExcl} />
        {rangeCell(a)}
      </div>
    );
  };

  const priceCell = (a: PriceAgg) => {
    if (a.modelId)
      return a.price ? (
        formatMoney(a.price.toFixed(2))
      ) : canEditPrice ? (
        <Link href={`/articles?q=${encodeURIComponent(a.label)}`} className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 underline underline-offset-2" title="Цена вводится в таблице «Изделия» — откроется строка этой модели">
          завести цену →
        </Link>
      ) : (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">цена не задана</span>
      );
    if (p.view !== "category") return <span className="text-neutral-500">—</span>;
    const m = catMarkup.get(a.label);
    return m && m.total > 0 ? <span className="text-xs text-neutral-500">цена у {m.priced} из {m.total} моделей</span> : "—";
  };

  const markupCell = (a: PriceAgg) => {
    if (a.modelId) {
      const c = calcOf(a);
      if (c.markupX == null) return "—";
      return (
        <div className={c.belowCost ? "text-red-700" : ""}>
          <span className="font-semibold">×{c.markupX.toFixed(2).replace(".", ",")}</span>
          <div className="text-[11px] text-neutral-500">маржа {pct1(c.marginPct ?? 0)}{c.belowCost ? " — ниже себестоимости" : ""}</div>
        </div>
      );
    }
    if (p.view !== "category") return "—";
    const m = catMarkup.get(a.label);
    return m?.pct != null ? <div>средняя ×{(1 + m.pct / 100).toFixed(2).replace(".", ",")}<div className="text-[11px] text-neutral-500">по моделям с ценой</div></div> : "—";
  };

  const recOf = (a: PriceAgg) => recommend(a, p.base, target);
  const recCell = (a: PriceAgg) => {
    const r = recOf(a);
    if (!r) return <span className="text-neutral-500">нужна целевая наценка</span>;
    const canAccept = canEditPrice && !!a.modelId && (!a.price || calcOf(a).belowCost);
    const cur = a.price ? formatMoney(a.price.toFixed(2)) : null;
    return (
      <div className="flex flex-col gap-1">
        <div>
          <span className="font-semibold"><Money incl={r.incl} excl={r.excl} /></span>
          <div className="text-[11px] text-neutral-500">рекомендация, не факт · округлено до 100 ₽</div>
        </div>
        {canAccept && a.modelId && (
          <AcceptPriceButton modelId={a.modelId} modelName={a.label} price={String(r.incl)} priceText={formatMoney(r.incl.toFixed(2))} currentText={cur} basis={`${basis}; цена с НДС`} />
        )}
        {!canEditPrice && a.modelId && !a.price && <span className="text-[11px] text-neutral-500">нет прав менять цену</span>}
      </div>
    );
  };

  const noteCell = (a: PriceAgg) => {
    const is = issuesOf(a).filter((x) => x !== "завести цену");
    return is.length ? (
      <ul className="text-[11px] text-amber-700">
        {is.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    ) : null;
  };

  const linkList = (rs: { id: string; workOrderNumber: string | null; number: string }[], limit = 40) => (
    <span className="flex flex-wrap gap-x-2 gap-y-1">
      {rs.slice(0, limit).map((r) => (
        <Link key={r.id} href={`/production/${r.id}`} className="underline underline-offset-2">{orderLabel(r)}</Link>
      ))}
      {rs.length > limit && <span className="text-neutral-500">…и ещё {rs.length - limit}</span>}
    </span>
  );
  const modelLinks = (ms: PriceAgg[]) => (
    <span className="flex flex-wrap gap-x-2 gap-y-1">
      {ms.map((m) => (
        <Link key={m.key} href={`/models/${m.key}`} className="underline underline-offset-2">{m.label}</Link>
      ))}
    </span>
  );

  const tabBtn = (active: boolean) => (active ? "rounded-md bg-neutral-900 px-3 py-1.5 text-white" : "rounded-md px-3 py-1.5 text-neutral-700 hover:bg-neutral-100");

  const pickerHidden = Array.from(pricingParams(p, { cols: [], all: false }).entries()) as [string, string][];
  const toggleAll = here(p.cols.length > 0 || !p.all ? { cols: [], all: !p.all || p.cols.length > 0 } : { cols: [], all: false });
  const labelHead = p.view === "model" ? "Модель" : p.view === "category" ? "Категория" : p.view === "fur" ? "Вид меха" : "Мех · категория";

  const mobileSortItems = [
    { key: "label", label: labelHead, href: thHref("label") },
    { key: "units", label: "Единиц", href: thHref("units") },
    { key: "cost", label: "Себестоимость за ед.", href: thHref("cost") },
    ...cols.map((c) => ({ key: c, label: colLabel(c, c4), href: thHref(c) })),
    { key: "price", label: "Цена", href: thHref("price") },
    { key: "markup", label: "Наценка", href: thHref("markup") },
    { key: "rec", label: "Рекомендуемая цена", href: thHref("rec") },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">Себестоимость и цены</h1><YearNote year={year} />
          <Mode4Badge mode={c4Mode} />
          <InfoHint label="О странице" wide>
            <p>Из чего складывается себестоимость единицы по моделям (артикулам), категориям и видам меха, сколько в ней мех, подкладка, 4%, расходы и работа, сколько шкур и метров подкладки уходит на единицу, какой был молоток закупки и какую цену заводить, чтобы получить нужную наценку. Считается по <b>завершённым</b> ТЗ выбранного года.</p>
            <p className="mt-1">
              <b>Себестоимость единицы</b> = (мех + подкладка + 4% + расходы ТЗ) ÷ произведено единиц — средневзвешенная: Σ сумм ÷ Σ единиц. Мех и подкладка — по лотам, из которых списано в ТЗ. 4% ({COMMISSION_RATE * 100}% — доп. комиссия посредника) добавляется к сырью и подкладке в режиме «С 4%»; работа им не облагается. НДС входит в цены лотов; «Без НДС» переключается в шапке.
            </p>
            <p className="mt-1">
              <b>Среднее — только средневзвешенное:</b> стоимость шкуры и молоток — вес в шкурах; шкуры, подкладка, работа и себестоимость на единицу — вес в единицах изделия. Формула каждой колонки — в подсказке у её заголовка. <b>Молоток</b> — цена шкуры на аукционе до сборов и выделки; лоты без молотка («нет данных») в среднее не входят.
            </p>
            <p className="mt-1">
              <b>Работа</b> (цена работы по ТЗ × кол-во) в себестоимость системы не входит. Переключатель «База наценки» решает, считать ли наценку к материалам (как на странице «Изделия») или к материалам вместе с работой.
            </p>
            <p className="mt-1">
              <b>Наценка (маркап)</b> = цена ÷ себестоимость − 1; «×2,50» значит цена в 2,5 раза выше себестоимости. <b>Маржа</b> = (цена − себестоимость) ÷ цена. Цена — розничная цена модели (поле на странице «Изделия»); наценка считается к себестоимости с НДС, как там.
            </p>
            {exampleModel && exCalc && exCalc.baseIncl && exampleModel.price && (
              <p className="mt-1">
                Пример — модель {exampleModel.label}: цена {formatMoney(exampleModel.price.toFixed(2))} ÷ себестоимость {formatMoney(exCalc.baseIncl.toFixed(2))} = ×{exCalc.markupX!.toFixed(2).replace(".", ",")}, наценка +{formatPercent(exCalc.markupPct!)}, маржа {pct1(exCalc.marginPct!)}. При целевой наценке {target ?? "—"}% рекомендуемая цена = себестоимость × {(1 + (target ?? 0) / 100).toFixed(2).replace(".", ",")}, округлённая до 100 ₽.
              </p>
            )}
            <p className="mt-1">Целевая наценка по умолчанию — средневзвешенная по моделям, у которых цена уже есть (вес — себестоимость партии). <b>Рекомендация — расчёт, а не факт</b>: рынок и скидки в нём не учтены.</p>
            <p className="mt-1"><b>Карточка артикула</b> — раскройте строку: сводка по годам, сезонам и партиям, шкуры и подкладка на единицу, мех, молоток, работа, полная себестоимость с разбросом, цена и наценка, затем состав, лоты (со ссылками) и ТЗ.</p>
          </InfoHint></div>
        <a href={`/analytics/pricing/export?${qs}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          CSV: таблица
        </a>
      </div>

      {/* Сводка */}
      <WidgetRow id="pricing" title="Цены и наценка — итоги">
      <div className="grid grid-cols-2 items-stretch gap-3 md:grid-cols-4">
        <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
          <TileHead>Моделей с завершёнными ТЗ</TileHead>
          <TileValue>{models.length}</TileValue>
        </div>
        <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
          <TileHead>С ценой / без цены</TileHead>
          <TileValue>{pricedCount} / <span className={"ml-1 " + (models.length - pricedCount > 0 ? "text-amber-700" : "")}>{models.length - pricedCount}</span></TileValue>
        </div>
        <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
          <TileHead>
            Средняя наценка
            <InfoHint label="Как посчитана" wide>Средневзвешенная по {def.count} моделям с ценой: Σ(наценка × себестоимость партии) ÷ Σ себестоимость партии. База — {baseLabel}{c4Mode === "on" ? ", с 4%" : ", без 4%"}.</InfoHint>
          </TileHead>
          <TileValue>{def.pct != null ? `×${(1 + def.pct / 100).toFixed(2).replace(".", ",")}` : "—"}</TileValue>
        </div>
        <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
          <TileHead>
            Целевая наценка
            <InfoHint label="О целевой наценке">Для рекомендаций по цене. {target != null ? `×${(1 + target / 100).toFixed(2).replace(".", ",")} = +${target}%. ` : ""}{typed != null ? "Введена вручную." : defRounded != null ? "По умолчанию — из данных." : "Цен ещё нет — введите вручную."} В поле ниже наценка вводится в процентах: 300 значит цена в 4 раза выше себестоимости (×4).</InfoHint>
          </TileHead>
          <TileValue>{target != null ? `×${(1 + target / 100).toFixed(2).replace(".", ",")}` : "не задана"}</TileValue>
        </div>
      </div>
      </WidgetRow>

      {/* Параметры и фильтры */}
      <AnalyticsFilterBar
        opts={opts}
        aucOf={aucOf}
        lead={[
          { type: "text", name: "m", label: "Целевая наценка, %", state: true, inputMode: "decimal", placeholder: defRounded != null ? String(defRounded) : "например 300", className: "sm:w-40" },
          { type: "multi", name: "base", label: "База наценки", single: true, state: true, allLabel: "Материалы + расходы (как в «Изделиях»)", options: [{ value: "full", label: "Материалы + расходы + работа" }], className: "sm:w-72" },
          { type: "multi", name: "only", label: "Показывать", single: true, state: true, allLabel: "Все", options: [{ value: "noprice", label: "Только без цены" }, { value: "issues", label: "Только с замечаниями" }] },
        ]}
      />
      {badInput && <span className="text-xs text-red-600">Наценка: введите число, например 350 — взято значение по умолчанию.</span>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1 text-sm">
          {(Object.keys(VIEW_LABEL) as PricingView[]).map((v) => (
            <Link key={v} href={here({ view: v, sort: "", dir: "desc" })} className={`${tabBtn(p.view === v)} max-md:inline-flex max-md:min-h-9 max-md:items-center`}>{VIEW_LABEL[v]}</Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-600" aria-label="Обозначения диаграммы">
          {[
            ["bg-emerald-600", "Мех"],
            ["bg-sky-500", "Подкладка"],
            ["bg-amber-500", "4%"],
            ["bg-neutral-400", "НДС в материалах"],
            ["bg-violet-500", "Расходы ТЗ"],
            ["bg-rose-500", "Работа"],
          ].map(([c, l]) => (
            <span key={l} className="inline-flex items-center gap-1">
              <span className={`inline-block size-2.5 rounded-sm ${c}`} />
              {l}
            </span>
          ))}
          <InfoHint label="О диаграмме" align="right">Структура полной стоимости единицы (материалы без НДС, НДС отдельно, 4%, расходы, работа) — сравнение «работа vs расходы vs материалы». Диаграмма всегда считается с НДС.</InfoHint>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ViewBar all={p.all} picked={p.cols.length > 0} cols={cols} toggleAllHref={toggleAll} action="/analytics/pricing" hidden={pickerHidden} />
        <MobileSort items={mobileSortItems} cur={sortState} />
        <span className="text-xs text-neutral-500">Строк: {shown.length}<InfoHint label="Сортировка">Клик по заголовку колонки — сортировка.</InfoHint></span>
      </div>

      <ResponsiveRows
        table={
          <Table>
            <Thead>
              <Tr>
                <SortTh left label={labelHead} href={thHref("label")} active={sortState.sort === "label"} dir={sortState.dir} />
                <SortTh label="Ед." href={thHref("units")} active={sortState.sort === "units"} dir={sortState.dir} hint="Σ изделий по завершённым ТЗ строки (ниже — число ТЗ)." />
                <SortTh
                  label="Себестоимость за ед."
                  suffix={c4}
                  href={thHref("cost")}
                  active={sortState.sort === "cost"}
                  dir={sortState.dir}
                  hint={<>Σ(себестоимость ТЗ) ÷ Σ единиц{p.base === "full" ? " + работа" : ""} по завершённым ТЗ с известной себестоимостью; ниже — разброс себестоимости единицы между ТЗ (мин–макс).</>}
                />
                {cols.map((c) => (
                  <SortTh key={c} label={colLabel(c, c4)} hint={COLUMNS[c].hint} href={thHref(c)} active={sortState.sort === c} dir={sortState.dir} />
                ))}
                <Th>Структура</Th>
                <SortTh label="Цена" href={thHref("price")} active={sortState.sort === "price"} dir={sortState.dir} hint="Розничная цена модели (поле на странице «Изделия»); у категорий и видов меха своей цены нет." />
                <SortTh label="Наценка" href={thHref("markup")} active={sortState.sort === "markup"} dir={sortState.dir} hint="Цена ÷ себестоимость (с НДС, по выбранной базе наценки)." />
                <SortTh label="Рекомендуемая цена" href={thHref("rec")} active={sortState.sort === "rec"} dir={sortState.dir} hint="Себестоимость × (1 + целевая наценка), округлено до 100 ₽. Расчёт, не факт." />
              </Tr>
            </Thead>
            <Tbody>
              {shown.map((a, idx) => (
                <Tr key={a.key} id={`row-${idx}`} className={a.modelId && !a.price ? "bg-amber-50/60" : ""}>
                  <Td className="font-medium">
                    <div title={a.modelId ? a.rows[0]?.modelHint : undefined}>{a.modelId ? (a.rows[0]?.modelLabel ?? a.label) : a.label}</div>
                    <div className="mt-0.5 font-normal">{lazyDetails(a, idx)}</div>
                    <div className="text-[11px] font-normal text-neutral-500">
                      {a.modelId ? a.category : p.view === "fur" || p.view === "furcat" ? `${a.modelCount} моделей` : `${a.modelCount} моделей`}
                      {a.modelId && (
                        <>
                          {" · "}
                          <Link href={`/models/${a.modelId}`} className="underline underline-offset-2">карточка модели</Link>
                        </>
                      )}
                    </div>
                    {noteCell(a)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatQty(a.units)}
                    <div className="text-[11px] text-neutral-500">ТЗ {a.orders}{a.inWorkOrders ? ` (+${a.inWorkOrders} в работе)` : ""}</div>
                  </Td>
                  <Td className="text-right tabular-nums">{costCell(a)}</Td>
                  {cols.map((c) => (
                    <Td key={c} className="text-right tabular-nums">
                      <MetricCell col={c} m={a.m} total={a.m} />
                    </Td>
                  ))}
                  <Td className="min-w-40">
                    <Bar a={a} />
                  </Td>
                  <Td className="text-right tabular-nums">{priceCell(a)}</Td>
                  <Td className="text-right tabular-nums">{markupCell(a)}</Td>
                  <Td className="text-right tabular-nums">{recCell(a)}</Td>
                </Tr>
              ))}
              {shown.length === 0 && (
                <Tr>
                  <Td colSpan={7 + cols.length} className="py-8 text-center text-neutral-500">
                    {year !== "all" ? `За ${year} год завершённых ТЗ по этим условиям нет` : "Нет данных по этим условиям"}
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        }
      >
        {shown.map((a, idx) => {
          const r = recOf(a);
          return (
            <RowCard
              key={a.key}
              className={a.modelId && !a.price ? "bg-amber-50/60" : ""}
              title={a.modelId ? (a.rows[0]?.modelLabel ?? a.label) : a.label}
              href={a.modelId ? `/models/${a.modelId}` : undefined}
              subtitle={a.modelId ? a.category : `${a.modelCount} моделей`}
              fields={[
                { label: "Единиц", value: `${formatQty(a.units)} (ТЗ ${a.orders})`, strong: true },
                { label: `Себестоимость за ед.${c4}`, value: costCell(a) },
                { label: "Цена", value: priceCell(a) },
                { label: "Наценка", value: markupCell(a) },
              ]}
              extra={
                <div className="flex flex-col gap-2">
                  <Bar a={a} />
                  {r && (
                    <div className="text-sm">
                      Рекомендуемая цена: <b><Money incl={r.incl} excl={r.excl} /></b>
                      <span className="text-[11px] text-neutral-500"> — рекомендация, не факт</span>
                    </div>
                  )}
                  {recCell(a)}
                  {noteCell(a)}
                  {lazyDetails(a, idx)}
                </div>
              }
              details={[
                ...cols.map((c) => ({ label: colLabel(c, c4), value: <MetricCell col={c} m={a.m} total={a.m} /> })),
              ]}
            />
          );
        })}
        {shown.length === 0 && <p className="py-8 text-center text-neutral-500">Нет данных по этим условиям</p>}
      </ResponsiveRows>

      {/* Качество данных */}
      <details className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
        <summary className="cursor-pointer text-base font-semibold">Качество данных</summary>
        <p className="mt-2 text-xs text-neutral-500">Проверки по моделям и ТЗ выбранного года (с учётом фильтров). Данные не правятся — только показано, что мешает посчитать цену.</p>
        <ul className="mt-2 flex flex-col gap-2">
          <li>
            Моделей без цены (с завершёнными ТЗ): <b>{modelsNoPrice.length}</b>
            {modelsNoPrice.length > 0 && (
              <div className="mt-1 text-xs">
                {modelLinks(modelsNoPrice)}{" "}
                <Link href={here({ only: "noprice", view: "model" })} className="ml-2 text-neutral-600 underline underline-offset-2">показать в таблице</Link>
              </div>
            )}
          </li>
          <li>
            Цена ниже себестоимости: <b>{modelsBelow.length}</b>
            {modelsBelow.length > 0 && <div className="mt-1 text-xs">{modelLinks(modelsBelow)}</div>}
          </li>
          <li>
            Модели, у которых есть завершённые ТЗ без состава материалов: <b>{modelsNoUsages.length}</b>
            {modelsNoUsages.length > 0 && <div className="mt-1 text-xs">{linkList(modelsNoUsages.flatMap((m) => m.noUsages))}</div>}
          </li>
          <li>
            Завершённые ТЗ с себестоимостью 0: <b>{modelsZero.reduce((s, m) => s + m.zeroCost.length, 0)}</b>
            {modelsZero.length > 0 && <div className="mt-1 text-xs">{linkList(modelsZero.flatMap((m) => m.zeroCost))}</div>}
            {inWorkNoCost.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-neutral-600">ТЗ «в работе» с себестоимостью 0: {inWorkNoCost.length} (партии без списаний, в расчёт не входят)</summary>
                <div className="mt-1 text-xs">{linkList(inWorkNoCost)}</div>
              </details>
            )}
          </li>
          <li>
            Завершённые ТЗ без цены работы: <b>{noWorkOrders.length}</b>
            {noWorkOrders.length > 0 && <div className="mt-1 text-xs">{linkList(noWorkOrders)}</div>}
          </li>
          <li className="text-xs text-neutral-500">
            Отдельной оптовой цены в базе нет — используется розничная цена модели. Фурнитура и прочие материалы в ТЗ не списываются: в составе только мех и подкладка.
          </li>
        </ul>
        <div className="mt-3 text-xs text-neutral-500">
          Что произведено — на вкладке{" "}
          <Link href="/analytics/products" className="underline underline-offset-2">«Изделия»</Link>; цены правятся на странице{" "}
          <Link href="/articles" className="underline underline-offset-2">«Изделия» (меню)</Link>.
        </div>
      </details>
    </div>
  );
}
