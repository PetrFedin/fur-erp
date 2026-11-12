"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/info-hint";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty, formatDec1 } from "@/lib/utils";
import { TH as SortableTH } from "@/components/table-head";
import { useClientSort } from "@/lib/use-client-sort";
import { buildTzTable, type TzTableRow } from "@/lib/article-tz-table";
import type { DrillOrder } from "@/lib/dashboard-drill";

export type TzMeta = { label: string; href: string; wordHref: string; color?: string };

const TD = "whitespace-nowrap px-2 py-2 text-right tabular-nums";
const money = (v: number) => (Math.abs(v) < 0.5 ? <span className="text-neutral-600">–</span> : formatMoney(Math.round(v)));

/**
 * Показатели артикула сверху вниз к итогу: 1) всего по артикулу по статьям, 2) таблица по ТЗ (статьи столбцами в одном порядке),
 * 3) итог и среднее на изделие внизу таблицы. Все цифры — из одних и тех же ТЗ, что плитки сверху; итог строго равен сумме строк.
 */
export function TzBreakdown({ orders, meta, c4, profile, furSizes }: { orders: DrillOrder[]; meta: Record<string, TzMeta>; c4: "on" | "off"; profile?: React.ReactNode; furSizes?: string }) {
  const { mode: vat } = useVatDisplay();
  const t = useMemo(() => buildTzTable(orders, vat), [orders, vat]);
  const T = t.total;
  const { th, sort } = useClientSort<TzTableRow>({
    tz: (r) => meta[r.id]?.label ?? r.id, qty: (r) => r.qty, furQ: (r) => r.furQ, fur: (r) => r.fur, liningQ: (r) => r.liningQ, lining: (r) => r.lining,
    c4: (r) => r.c4, other: (r) => r.other, work: (r) => r.work, total: (r) => r.total,
  });
  const showC4 = c4 === "on" && t.total.c4 !== 0;
  const showLining = T.liningQ > 0 || T.lining !== 0;
  const showOther = t.total.other !== 0 || t.rows.some((r) => r.other !== 0);
  const noFur = t.rows.filter((r) => r.noFur);

  const perUnitMoney = (v: number) => (Math.abs(v) < 0.5 ? <span className="text-neutral-600">–</span> : formatMoney(Math.round(v)));
  const perUnitQty = (v: number, unit: string) => (v > 0 ? `${formatQty(Math.round(v * 100) / 100)} ${unit}` : <span className="text-neutral-600">–</span>);

  return (
    <div className="flex flex-col gap-4">
      {profile}

      <Card id="model-tz" className="scroll-mt-4">
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-1">
            ТЗ артикула и их состав
            <InfoHint label="Что в таблице" wide>
              <p>По строке на ТЗ: сколько изделий, сколько шкур меха и подкладки списано, во что обошлись мех, подкладка, 4 %, расходы и работа. Номер ТЗ открывает его карточку, «Word» — финальный Word этого ТЗ (сохранённый, а если его нет — собранный из данных ТЗ).</p>
              <p className="mt-1">Строка «Итого» — сумма строк, «На изделие» — итого ÷ изделий (средневзвешенное по количеству, не среднее по ТЗ).</p>
            </InfoHint>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {furSizes ? <p className="mb-2 text-sm text-neutral-700">Размер шкур: {furSizes}</p> : null}
          {noFur.length > 0 && (
            <p role="status" className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              В {noFur.length === 1 ? "ТЗ" : "ТЗ"}{" "}
              {noFur.map((r, i) => <span key={r.id}>{i > 0 ? ", " : ""}<Link href={meta[r.id]?.href ?? "#"} className="font-medium underline">{meta[r.id]?.label ?? r.id}</Link></span>)}{" "}
              не списан мех — расход меха на изделие занижен.
            </p>
          )}
          <div className="table-scroll scroll-hint overflow-x-auto">
            <table className="w-max min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-200">
                  <SortableTH label="ТЗ" align="left" className="sm:sticky sm:left-0 sm:z-10 bg-white" {...th("tz")} />
                  <SortableTH label="Изделий" unit="шт." {...th("qty")} />
                  <SortableTH label="Шкур" unit="шт." {...th("furQ")} />
                  <SortableTH label="Мех" unit="₽" {...th("fur")} />
                  {showLining && <SortableTH label="Подкладка" unit="м" {...th("liningQ")} />}
                  {showLining && <SortableTH label="Подкладка" unit="₽" {...th("lining")} />}
                  {showC4 && <SortableTH label="4 %" unit="₽" {...th("c4")} />}
                  {showOther && <SortableTH label="Расходы" unit="₽" {...th("other")} />}
                  <SortableTH label="Работа" unit="₽" {...th("work")} />
                  <SortableTH label="Итого" unit="₽" sep {...th("total")} />
                </tr>
              </thead>
              <tbody>
                {sort(t.rows).map((r) => {
                  const m = meta[r.id];
                  return (
                    <tr key={r.id} className="border-b border-neutral-100 align-top">
                      <th scope="row" className="sm:sticky sm:left-0 sm:z-10 bg-white px-2 py-2 text-left font-normal">
                        <Link href={m?.href ?? "#"} className="inline-flex min-h-11 items-center font-medium text-blue-700 hover:underline sm:min-h-0">{m?.label ?? r.id}</Link>
                        <a href={m?.wordHref ?? "#"} className="ml-2 inline-flex min-h-11 items-center text-xs text-blue-700 hover:underline sm:min-h-0" title="Финальный Word этого ТЗ">Word</a>
                        {m?.color ? <span className="ml-2 text-xs text-neutral-700" data-testid="tz-color">{m.color}</span> : null}
                        {r.noFur && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">нет меха</span>}
                      </th>
                      <td className={TD}>{formatQty(r.qty)}</td>
                      <td className={TD}>{r.furQ > 0 ? formatDec1(r.furQ) : <span className="text-neutral-600">–</span>}</td>
                      <td className={TD}>{money(r.fur)}</td>
                      {showLining && <td className={TD}>{r.liningQ > 0 ? formatDec1(r.liningQ) : <span className="text-neutral-600">–</span>}</td>}
                      {showLining && <td className={TD}>{money(r.lining)}</td>}
                      {showC4 && <td className={TD}>{money(r.c4)}</td>}
                      {showOther && <td className={TD}>{money(r.other)}</td>}
                      <td className={TD}>{money(r.work)}</td>
                      <td className={TD + " border-l border-neutral-200 font-medium"}>{money(r.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="row-total" data-testid="tz-total">
                  <th scope="row" className="sm:sticky sm:left-0 sm:z-10 px-2 py-2 text-left">Итого</th>
                  <td className={TD}>{formatQty(T.qty)}</td>
                  <td className={TD}>{T.furQ > 0 ? formatDec1(T.furQ) : "–"}</td>
                  <td className={TD}>{money(T.fur)}</td>
                  {showLining && <td className={TD}>{T.liningQ > 0 ? formatDec1(T.liningQ) : "–"}</td>}
                  {showLining && <td className={TD}>{money(T.lining)}</td>}
                  {showC4 && <td className={TD}>{money(T.c4)}</td>}
                  {showOther && <td className={TD}>{money(T.other)}</td>}
                  <td className={TD}>{money(T.work)}</td>
                  <td className={TD + " border-l border-neutral-200"}>{money(T.total)}</td>
                </tr>
                {t.perUnit && (
                  <tr className="border-b border-neutral-100" data-testid="tz-per-unit">
                    <th scope="row" className="sm:sticky sm:left-0 sm:z-10 bg-white px-2 py-2 text-left font-medium">На изделие</th>
                    <td className={TD}>1</td>
                    <td className={TD}>{perUnitQty(t.perUnit.furQ, "шк.")}</td>
                    <td className={TD}>{perUnitMoney(t.perUnit.fur)}</td>
                    {showLining && <td className={TD}>{perUnitQty(t.perUnit.liningQ, "м")}</td>}
                    {showLining && <td className={TD}>{perUnitMoney(t.perUnit.lining)}</td>}
                    {showC4 && <td className={TD}>{perUnitMoney(t.perUnit.c4)}</td>}
                    {showOther && <td className={TD}>{perUnitMoney(t.perUnit.other)}</td>}
                    <td className={TD}>{perUnitMoney(t.perUnit.work)}</td>
                    <td className={TD + " border-l border-neutral-200 font-medium"}>{perUnitMoney(t.perUnit.total)}</td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
