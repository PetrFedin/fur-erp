import { Fragment } from "react";
import { Th } from "@/components/ui/table";
import { InfoHint } from "@/components/info-hint";
import { TotalLabel } from "@/components/total-label";
import { formatMarkup, formatMoney } from "@/lib/utils";

type MarkupSrc = { markup: number | null; sellingPrice: number | null; unitIncl: number | null; qty: number; primaryFur: string | null; group: string; model: { category: string | null } };

// Таблица «мех × категория»: число артикулов, средняя розничная цена и средняя наценка (артикулы с ценой и себестоимостью).
export function markupByFur<R extends MarkupSrc>(rows: R[]) {
  type Agg = { n: number; price: number; markup: number };
  // Средневзвешенные по выпуску: цена = Σ(цена × выпуск) ÷ Σ выпуск; маркап = Σ(цена × выпуск) ÷ Σ(себестоимость ед. × выпуск).
  const aggOf = (list: R[]): Agg | null => {
    const priced = list.filter((r) => r.markup && r.sellingPrice && r.unitIncl && r.qty > 0);
    if (priced.length === 0) return null;
    const sumW = priced.reduce((a, r) => a + r.qty, 0);
    const retail = priced.reduce((a, r) => a + r.sellingPrice! * r.qty, 0);
    const cost = priced.reduce((a, r) => a + r.unitIncl! * r.qty, 0);
    return { n: priced.length, price: retail / sumW, markup: cost > 0 ? retail / cost : 0 };
  };
  const catOf = (r: R) => r.model.category?.trim() || "Без категории";
  // Мех → категория 1 (Одежда / Аксессуары) → категория 2 (категория артикула); пересчитывается по тем же фильтрам, что и список.
  const furGroups = Array.from(new Set(rows.filter((r) => r.markup && r.primaryFur).map((r) => r.primaryFur!)))
    .map((fur) => {
      const inFur = rows.filter((r) => r.primaryFur === fur);
      const grps = Array.from(new Set(inFur.filter((r) => r.markup).map((r) => r.group)))
        .map((grp) => {
          const inGrp = inFur.filter((r) => r.group === grp);
          const cats = Array.from(new Set(inGrp.filter((r) => r.markup).map(catOf)))
            .map((cat) => ({ cat, agg: aggOf(inGrp.filter((r) => catOf(r) === cat))! }))
            .filter((c) => c.agg)
            .sort((x, y) => y.agg.markup - x.agg.markup);
          return { grp, agg: aggOf(inGrp)!, cats };
        })
        .filter((g) => g.agg)
        .sort((x, y) => y.agg.markup - x.agg.markup);
      return { fur, total: aggOf(inFur)!, grps };
    })
    .filter((g) => g.total)
    .sort((x, y) => y.total.markup - x.total.markup);
  const markupTotal = aggOf(rows);
  return { furGroups, markupTotal };
}

export type MarkupByFur = ReturnType<typeof markupByFur>;

export function MarkupByFurTable({ furGroups, markupTotal }: { furGroups: MarkupByFur["furGroups"]; markupTotal: NonNullable<MarkupByFur["markupTotal"]> }) {
  const fmtX = (v: number) => formatMarkup(v);
  return (
    <details className="rounded-lg border border-neutral-200 bg-white" data-testid="articles-markup">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium max-md:py-3">Розничная цена и наценка по меху и категориям</summary>
      <div className="overflow-x-auto border-t border-neutral-200">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
            <Th>Мех / категория</Th>
            <Th className="text-right" unit="шт.">Артикулов</Th>
            <Th className="text-right" unit="₽">Ср. розничная цена</Th>
            <Th className="text-right">
              Ср. маркап
              <InfoHint label="Как считается средневзвешенное">Взвешено по выпуску (артикулы с ценой): розничная цена = Σ(цена × выпуск) ÷ Σ выпуск, маркап = Σ(цена × выпуск) ÷ Σ(себестоимость ед. × выпуск). Меняете фильтры — таблица пересчитывается.</InfoHint>
            </Th>
          </tr>
        </thead>
        <tbody>
          {furGroups.map((g) => (
            <Fragment key={g.fur}>
              <tr className="border-b border-neutral-100 bg-neutral-50 font-semibold">
                <td className="px-3 py-1.5">{g.fur}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{g.total.n}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(g.total.price.toFixed(0))}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtX(g.total.markup)}</td>
              </tr>
              {g.grps.map((gr) => (
                <Fragment key={g.fur + gr.grp}>
                  <tr className="border-b border-neutral-100 font-medium">
                    <td className="px-3 py-1.5 pl-6">{gr.cats.length === 1 ? `${gr.grp} · ${gr.cats[0].cat}` : gr.grp}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{gr.agg.n}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(gr.agg.price.toFixed(0))}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtX(gr.agg.markup)}</td>
                  </tr>
                  {gr.cats.length > 1 && gr.cats.map((c) => (
                    <tr key={g.fur + gr.grp + c.cat} className="border-b border-neutral-100 text-neutral-700">
                      <td className="px-3 py-1 pl-10">{c.cat}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{c.agg.n}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{formatMoney(c.agg.price.toFixed(0))}</td>
                      <td className="px-3 py-1 text-right tabular-nums">{fmtX(c.agg.markup)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </Fragment>
          ))}
          <tr className="row-total">
            <td className="px-3 py-1.5"><TotalLabel unit="₽" avg /></td>
            <td className="px-3 py-1.5 text-right tabular-nums">{markupTotal.n}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(markupTotal.price.toFixed(0))}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{fmtX(markupTotal.markup)}</td>
          </tr>
        </tbody>
      </table>
      </div>
    </details>
  );
}
