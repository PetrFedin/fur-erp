"use client";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { vatPeriodLabel } from "@/lib/vat-by-date";
import { lineCalc } from "@/lib/tz-calc";
import { formatDec1 } from "@/lib/utils";
import { LotPicker, type LotOpt } from "../lot-picker";
import { M } from "./parts";
import { num, th, type Line } from "./types";

/** Таблица строк списания (мех или подкладка): лот, остаток, цена, НДС, количество, 4 %, сумма. */
export function LotLineTable({ kind, ls, pool, unitLabel, lotById, taken, ownVat, upd, del }: {
  kind: "fur" | "lining";
  ls: Line[];
  pool: LotOpt[];
  unitLabel: string;
  lotById: Map<string, LotOpt>;
  taken: Record<string, number>;
  ownVat: (lot: LotOpt) => number | null;
  upd: (kind: "fur" | "lining", key: number, patch: Partial<Line>) => void;
  del: (kind: "fur" | "lining", key: number) => void;
}) {
  return (
    <div className="table-scroll overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="border-b border-neutral-200">
            <th className={th}>Лот</th>
            <th className={`${th} text-right`}>Остаток</th>
            <th className={`${th} text-right`}><span className="inline-flex flex-col items-end leading-tight"><span>Цена</span><span className="text-[11px] font-normal opacity-80">₽/{unitLabel}</span></span></th>
            <th className={`${th} text-right`}>НДС</th>
            <th className={`${th} w-28 text-right`}><span className="inline-flex flex-col items-end leading-tight"><span>Кол-во</span><span className="text-[11px] font-normal opacity-80">{unitLabel}</span></span></th>
            <th className={`${th} text-center`}><span className="inline-flex flex-col items-center leading-tight"><span>4 %</span><span className="text-[11px] font-normal opacity-80">₽</span></span></th>
            <th className={`${th} text-right`}><span className="inline-flex flex-col items-end leading-tight"><span>Сумма</span><span className="text-[11px] font-normal opacity-80">₽</span></span></th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {ls.map((l, i) => {
            const lot = lotById.get(l.lotId);
            const q = num(l.qty);
            const own = lot ? ownVat(lot) : null;
            const c = lot && q > 0 ? lineCalc({ lot: { unitCost: lot.unitCost, unitCostExcl: lot.unitCostExcl, vatRate: lot.vatRate }, qty: q, commission4: l.c4, vatRate: own }) : null;
            const over = lot && (taken[lot.id] ?? 0) > lot.remaining + 1e-9;
            return (
              <tr key={l.key} className="border-b border-neutral-100 align-top">
                <td className="min-w-[16rem] px-2 py-1.5">
                  <LotPicker lots={pool} value={l.lotId} onChange={(id) => upd(kind, l.key, { lotId: id })} taken={taken} ariaLabel={`Лот, строка ${i + 1}`} />
                  {lot && (
                    <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-neutral-500">
                      <Link href={`/analytics/raw/lot/${lot.id}`} target="_blank" className="text-blue-700 hover:underline" title="Карточка лота: закупка, где ещё использован, остаток">лот →</Link>
                      {lot.purchaseId && <Link href={`/purchases/${lot.purchaseId}`} target="_blank" className="text-blue-700 hover:underline" title="Закупка, из которой пришёл лот">закупка {lot.purchaseNumber} →</Link>}
                      {lot.auction && <span>{lot.auction}</span>}
                    </span>
                  )}
                </td>
                <td className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${over ? "text-red-600" : "text-neutral-600"}`}>{lot ? formatDec1(lot.remaining) : "–"}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                  {lot ? <><M incl={lot.unitCost} excl={lot.unitCostExcl} /><span className="block text-[11px] text-neutral-600">из лота</span></> : "–"}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-neutral-600">
                  {lot ? <>{own ?? lot.vatRate} %{own != null && <span className="block text-[11px] text-amber-700">в лоте {lot.vatRate} %</span>}<span className="block text-[11px] text-neutral-600">{vatPeriodLabel(lot.purchaseDate)}</span></> : "–"}
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    aria-label={`Количество, строка ${i + 1}`}
                    type="number" step="0.001" min="0" inputMode="decimal"
                    value={l.qty}
                    onChange={(e) => upd(kind, l.key, { qty: e.target.value })}
                    className={`h-8 text-right tabular-nums ${over ? "border-red-500 bg-red-50" : ""}`}
                  />
                </td>
                <td className="px-2 py-2 text-center">
                  <input
                    type="checkbox" checked={l.c4} aria-label={`Начислять 4 %, строка ${i + 1}`}
                    onChange={(e) => upd(kind, l.key, { c4: e.target.checked, c4Touched: true })}
                    className="h-4 w-4"
                  />
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                  {c ? (
                    <>
                      <span className="font-medium"><M incl={c.incl4} excl={c.excl4} /></span>
                      {l.c4 && <span className="block text-[11px] text-neutral-600">без 4 %: <M incl={c.baseIncl} excl={c.baseExcl} /></span>}
                    </>
                  ) : "–"}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button type="button" onClick={() => del(kind, l.key)} className="rounded px-1.5 py-0.5 text-neutral-600 hover:bg-neutral-100 hover:text-red-600" aria-label={`Убрать строку ${i + 1}`} title="Убрать строку">✕</button>
                </td>
              </tr>
            );
          })}
          {ls.length === 0 && (
            <tr><td colSpan={8} className="px-2 py-3 text-center text-neutral-500">{kind === "fur" ? "Мех не добавлен" : "Подкладка не добавлена"}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
