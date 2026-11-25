import Link from "next/link";
import { ruGradeLabel } from "@/lib/fur-ref";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Money } from "@/components/money";
import { InfoHint } from "@/components/info-hint";
import { formatMoney, formatQty, formatMarkupPct, formatMarkup, formatDec1 } from "@/lib/utils";
import { calcPrice, recommend, type PriceAgg } from "@/lib/analytics-pricing";
import { derived } from "@/lib/analytics-metrics";
import type { Commission4Mode } from "@/lib/commission4-mode";
import { pct0, q2 } from "../../_shared/metric-ui";
import { orderLabel, pct1, rub } from "./format";

export type DetailsCtx = { base: "mat" | "full"; target: number | null; c4Mode: Commission4Mode; c4: string };

// Подробности раскрытой строки: сводка (карточка артикула), состав, лоты и ТЗ.
export function pricingDetails(agg: PriceAgg, ctx: DetailsCtx) {
  const { base, target, c4Mode, c4 } = ctx;
  const calcOf = (a: PriceAgg) => calcPrice(a, base, a.price);

  const perUnit = (a: PriceAgg, x: number) => (a.unitsCosted > 0 ? x / a.unitsCosted : 0);

  // Состав себестоимости единицы: «что входит».
  const composition = (a: PriceAgg) => {
    const u = (x: number) => perUnit(a, x);
    const full = a.costIncl + a.work;
    const share = (x: number) => (full > 0 ? pct1((x / full) * 100) : "–");
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
            row(`4 % на сырьё и подкладку`, a.c4Incl, a.c4Excl, a.c4Incl)
          ) : (
            <Tr className="text-neutral-500">
              <Td>4 % — не включено (режим «Без 4 %»)</Td>
              <Td className="text-right tabular-nums">+{rub(u(c4Excluded))}</Td>
              <Td className="text-right tabular-nums">+{rub(c4Excluded)}</Td>
              <Td className="text-right">–</Td>
            </Tr>
          )}
          {row("Расходы ТЗ", a.expenses, a.expenses, a.expenses)}
          {row(`Себестоимость сырья${c4}`, a.costIncl, a.costExcl, a.costIncl, { strong: true })}
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
                {(l.grade || l.color) && <span className="ml-1 text-xs text-neutral-500">{[ruGradeLabel(l.grade), l.color].filter(Boolean).join(", ")}</span>}
                {l.purchaseId && (
                  <div className="text-[11px] text-neutral-500">
                    <Link href={`/purchases/${l.purchaseId}`} className="underline underline-offset-2">закупка {l.purchaseNumber}</Link>
                    {l.auction ? ` · ${l.auction}` : ""}
                  </div>
                )}
              </Td>
              <Td>{l.rawName}</Td>
              <Td className="text-right tabular-nums">{formatDec1(l.qty)} {l.isLining ? "м" : "шк."}</Td>
              <Td className="text-right tabular-nums"><Money incl={l.qty > 0 ? l.incl / l.qty : 0} excl={l.qty > 0 ? l.excl / l.qty : 0} /></Td>
              <Td className="text-right tabular-nums">
                {l.isLining ? <span className="text-neutral-500">·</span> : l.hammerExcl != null ? (
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
            <Link href={`/production/${r.id}`} title={`Внутренний номер ${r.number}`} className="font-medium text-neutral-800 underline underline-offset-2">ТЗ {orderLabel(r)}</Link>
            {!a.modelId && <span title={r.modelHint}>{r.modelLabel}</span>}
            <span>{formatQty(r.qty)} ед.</span>
            <span>{r.costIncl > 0 ? <><Money incl={r.costIncl / Math.max(r.qty, 1)} excl={r.costExcl / Math.max(r.qty, 1)} /> за ед.</> : "себестоимость 0"}</span>
            {r.furQty > 0 && <span>шкур {formatDec1(r.furQty)}</span>}
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
      const k = key === "year" ? (r.year == null ? "год не определён" : String(r.year)) : key === "season" ? (r.seasonCode ?? "сезон не указан") : r.batchNumber == null ? "вне партий" : `партия ${r.batchNumber}`;
      m.set(k, (m.get(k) ?? 0) + r.qty);
    }
    return Array.from(m, ([k, v]) => `${k}: ${formatQty(v)}`).sort((x, y) => x.localeCompare(y, "ru", { numeric: true })).join(" · ");
  };

  // Карточка артикула: сводка по всем показателям и ссылки на ТЗ и лоты.
  const summary = (a: PriceAgg) => {
    const d = derived(a.m);
    const c = calcOf(a);
    const r = recommend(a, base, target);
    const dash = <span className="text-neutral-500">–</span>;
    const items: [string, React.ReactNode][] = [
      ["Готово (завершённые ТЗ)", <>{formatQty(a.units)} ед. · ТЗ {a.orders}{a.inWorkOrders ? ` (+${a.inWorkOrders} в работе)` : ""}</>],
      ["По годам", breakdown(a, "year") || dash],
      ["По сезонам", a.rows.some((x) => x.seasonCode) ? breakdown(a, "season") : <span className="text-neutral-500">сезон в ТЗ не указан</span>],
      ["По партиям", breakdown(a, "batch") || dash],
      ["Шкур на ед.", d.skinsPerUnit != null ? <>{q2(d.skinsPerUnit)} <span className="text-neutral-500">(Σ {formatDec1(a.m.skins)})</span></> : dash],
      ["Подкладка, м на ед.", d.liningPerUnit != null ? <>{q2(d.liningPerUnit)} <span className="text-neutral-500">(Σ {q2(a.m.liningM)} м)</span></> : dash],
      [`Мех за ед.${c4}`, d.furPerUnit ? <Money incl={d.furPerUnit.incl} excl={d.furPerUnit.excl} /> : dash],
      [`Мех за шкуру${c4}`, d.furPerSkin ? <Money incl={d.furPerSkin.incl} excl={d.furPerSkin.excl} /> : dash],
      ["Молоток за шкуру", d.hammerPerSkin ? <><Money incl={d.hammerPerSkin.incl} excl={d.hammerPerSkin.excl} /> <span className="text-neutral-500">(данные: {pct0(d.hammerSkinShare ?? 0)} шкур, лотов {a.m.lotsHammer} из {a.m.lots})</span></> : <span className="text-neutral-500">нет данных (лотов {a.m.lots})</span>],
      ["Работа за ед.", d.workPerUnit != null ? formatMoney(d.workPerUnit.toFixed(2)) : dash],
      [`Себестоимость сырья за ед.${c4}`, d.costPerUnit ? <><Money incl={d.costPerUnit.incl} excl={d.costPerUnit.excl} />{a.m.minCostIncl != null && a.m.maxCostIncl != null && a.costedOrders > 1 && <span className="text-neutral-500"> (от <Money incl={a.m.minCostIncl} excl={a.m.minCostExcl} /> до <Money incl={a.m.maxCostIncl} excl={a.m.maxCostExcl} />)</span>}</> : dash],
      [`Полная с работой${c4}`, d.fullPerUnit ? <><Money incl={d.fullPerUnit.incl} excl={d.fullPerUnit.excl} />{a.m.minFullIncl != null && a.m.maxFullIncl != null && a.costedOrders > 1 && <span className="text-neutral-500"> (от <Money incl={a.m.minFullIncl} excl={a.m.minFullExcl} /> до <Money incl={a.m.maxFullIncl} excl={a.m.maxFullExcl} />)</span>}</> : dash],
    ];
    if (a.modelId) {
      items.push(
        ["Цена", a.price ? formatMoney(a.price.toFixed(2)) : <span className="text-amber-700">не задана</span>],
        ["Наценка", c.markupX != null ? <>{formatMarkup(c.markupX)} (+{formatMarkupPct(c.markupPct ?? 0)}), маржа {pct1(c.marginPct ?? 0)}</> : dash],
        ["Рекомендуемая цена", r ? <><Money incl={r.incl} excl={r.excl} /> <span className="text-neutral-500">(при наценке {formatMarkupPct(target ?? 0)}, не факт)</span></> : dash],
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

  return details(agg);
}
