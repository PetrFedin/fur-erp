import Link from "next/link";
import { Money } from "@/components/money";
import { formatMoney, formatMarkup } from "@/lib/utils";
import { calcPrice, recommend, type PriceAgg, type PricingView } from "@/lib/analytics-pricing";
import { AcceptPriceButton } from "../accept-price-button";
import { pct1, pricingIssues } from "./format";

export type CellsCtx = {
  base: "mat" | "full";
  view: PricingView;
  target: number | null;
  canEditPrice: boolean;
  catMarkup: Map<string, { pct: number | null; priced: number; total: number }>;
  basis: string;
};

// Ячейки строки таблицы (и карточки на телефоне).
export function pricingCells(ctx: CellsCtx) {
  const { base, view, target, canEditPrice, catMarkup, basis } = ctx;
  const calcOf = (a: PriceAgg) => calcPrice(a, base, a.price);

  const rangeCell = (a: PriceAgg) =>
    a.minUnitIncl != null && a.maxUnitIncl != null && a.costedOrders > 1 && Math.round(Number(a.minUnitIncl)) !== Math.round(Number(a.maxUnitIncl)) ? (
      <div className="text-[11px] leading-tight text-neutral-500" title={`По ${a.costedOrders} ТЗ`}>
        от <Money incl={a.minUnitIncl} excl={a.minUnitExcl} /> до <Money incl={a.maxUnitIncl} excl={a.maxUnitExcl} />
      </div>
    ) : null;

  const costCell = (a: PriceAgg) => {
    const c = calcOf(a);
    return c.baseIncl == null ? "–" : (
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
    if (view !== "category") return <span className="text-neutral-500">–</span>;
    const m = catMarkup.get(a.label);
    return m && m.total > 0 ? <span className="text-xs text-neutral-500">цена у {m.priced} из {m.total} моделей</span> : "–";
  };

  const markupCell = (a: PriceAgg) => {
    if (a.modelId) {
      const c = calcOf(a);
      if (c.markupX == null) return "–";
      return (
        <div className={c.belowCost ? "text-red-700" : ""}>
          <span className="font-semibold">{formatMarkup(c.markupX)}</span>
          <div className="text-[11px] text-neutral-500" title={`База: ${base === "full" ? "с работой" : "сырьё без работы"}, завершённые ТЗ`}>маржа {pct1(c.marginPct ?? 0)}{c.belowCost ? " — ниже себестоимости" : ""}</div>
        </div>
      );
    }
    if (view !== "category") return "–";
    const m = catMarkup.get(a.label);
    return m?.pct != null ? <div>средняя {formatMarkup(1 + m.pct / 100)}<div className="text-[11px] text-neutral-500">по моделям с ценой</div></div> : "–";
  };

  const recOf = (a: PriceAgg) => recommend(a, base, target);
  const recCell = (a: PriceAgg) => {
    const r = recOf(a);
    if (!r) return <span className="text-neutral-500">нужна целевая наценка</span>;
    const canAccept = canEditPrice && !!a.modelId && (!a.price || calcOf(a).belowCost);
    const cur = a.price ? formatMoney(a.price.toFixed(2)) : null;
    return (
      <div className="flex flex-col gap-1">
        <div>
          <span className="font-semibold"><Money incl={r.incl} excl={r.excl} /></span>
        </div>
        {canAccept && a.modelId && (
          <AcceptPriceButton modelId={a.modelId} modelName={a.label} price={String(r.incl)} priceText={formatMoney(r.incl.toFixed(2))} currentText={cur} basis={`${basis}; цена с НДС`} />
        )}
        {!canEditPrice && a.modelId && !a.price && <span className="text-[11px] text-neutral-500">нет прав менять цену</span>}
      </div>
    );
  };

  const noteCell = (a: PriceAgg) => {
    const is = pricingIssues(a, base).filter((x) => x !== "завести цену");
    return is.length ? (
      <ul className="text-[11px] text-amber-700">
        {is.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    ) : null;
  };

  return { costCell, priceCell, markupCell, recOf, recCell, noteCell };
}
