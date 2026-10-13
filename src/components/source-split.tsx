"use client";

import { useMemo } from "react";
import { InfoHint } from "@/components/info-hint";
import { TH } from "@/components/table-head";
import { UNIT } from "@/lib/units";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatPercent, formatQty } from "@/lib/utils";
import { SOURCE_LABEL, splitLotsBySource, type PurchaseSource } from "@/lib/purchase-source";
import type { FlowFigures, FurLot } from "@/lib/fur-table";
import { TILE_BOX, TileHead } from "@/app/(app)/dashboard/tile";

const rub = (v: number) => formatMoney(v.toFixed(2));
const BL = " border-l border-neutral-200";

/** Полоска доли: те же токены, что у полосок «использовано» в таблицах (серый фон + акцент темы). */
function Bar({ pct, label }: { pct: number; label: string }) {
  return (
    <span role="img" aria-label={label} className="block h-1.5 w-full min-w-12 overflow-hidden rounded-full" style={{ background: "#e7e5e4" }}>
      <span className="block h-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: "var(--ui-accent)" }} />
    </span>
  );
}

/**
 * Разбивка «Куплено» под итоговыми плитками сырья: на аукционах / у поставщика (+ шкуры подрядчика и «заказано, не получено» отдельными строками).
 * Считается из тех же лотов, что и «Куплено» (flowOf/figures); итог — «Куплено» слайда (total), расхождение округления — отдельной строкой.
 * Определение «аукцион» — одно на проект: src/lib/purchase-source.ts.
 */
export function SourceSplit({ lots, total, compactTitle = false }: { lots: FurLot[]; total: { incl: FlowFigures; excl: FlowFigures }; compactTitle?: boolean }) {
  const { mode: vat } = useVatDisplay();
  const rows = useMemo(() => splitLotsBySource(lots), [lots]);
  const T = total[vat];
  const val = (r: { incl: number; excl: number }) => (vat === "incl" ? r.incl : r.excl);
  const sumQ = rows.reduce((a, r) => a + r.qty, 0);
  const sumV = rows.reduce((a, r) => a + val(r), 0);
  const dQ = T.recvQty - sumQ;
  const dV = T.recvValue - sumV;
  const hasDiff = Math.abs(dQ) >= 0.5 || Math.abs(dV) >= 0.5;
  if (rows.length === 0 && T.recvQty <= 0) return null;
  const pctQ = (q: number) => (T.recvQty > 0 ? (q / T.recvQty) * 100 : 0);
  const pctV = (v: number) => (T.recvValue > 0 ? (v / T.recvValue) * 100 : 0);
  const vatWord = vat === "incl" ? "с НДС" : "без НДС";
  const cell = "whitespace-nowrap px-1.5 py-1.5 text-right tabular-nums";
  const line = (key: string, label: string, q: number, v: number, muted = false, lotsCount?: number) => (
    <tr key={key} data-source={key} className={"border-t border-neutral-100 " + (muted ? "text-neutral-500" : "")}>
      <td className="whitespace-nowrap py-1.5 pr-2 text-left font-medium">{label}{lotsCount != null ? <span className="ml-1.5 text-[11px] font-normal text-neutral-500">{lotsCount} лот.</span> : null}</td>
      <td className={cell + BL}>{formatQty(q)} шт.</td>
      <td className={cell}>{formatPercent(pctQ(q))}</td>
      <td className={cell + BL}>{rub(v)}</td>
      <td className={cell}>{formatPercent(pctV(v))}</td>
      <td className={"px-1.5 py-1.5" + BL}><Bar pct={pctV(v)} label={`${label}: ${formatPercent(pctV(v))} от «Куплено»`} /></td>
    </tr>
  );
  return (
    <div className={TILE_BOX + " mt-2"} data-testid="source-split">
      <TileHead>{compactTitle ? "Куплено — источники" : "Куплено: на аукционах и у поставщика"}</TileHead>
      <div className="absolute right-3 top-3">
        <InfoHint label="Как считается разбивка «Куплено»" align="right" wide>
          <p><b>Куплено на аукционах</b> — закупки, привязанные к настоящему аукциону справочника (SAGA, Kopenhagen, Fur Harvesters, AME, Союзпушнина, Русьпушнина). Привязка — поле закупки «Аукцион», а не текст в названии.</p>
          <p className="mt-1"><b>Куплено у поставщика</b> — закупки без аукциона: напрямую у поставщика или фермы (КФХ), белая норка №80/№96, красная лиса со склада и прочие закупки, у которых аукциона нет.</p>
          <p className="mt-1"><b>Шкуры подрядчика</b> — сырьё подрядчика, оплаченное в составе счетов за пошив (закупки с этим признаком и оплаты шкур, учтённые на Главной); <b>заказано, не получено</b> — закупки в статусе черновика без лотов (например, СП 09.26, FH 06.26).</p>
          <p className="mt-1">Сумма строк равна «Куплено» слайда ({vatWord}, всегда без 4%). Доли — от «Куплено» отдельно по штукам и по рублям; если из-за округления сумма строк отличается, разница показана строкой «округление».</p>
        </InfoHint>
      </div>
      <div className="scroll-hint -mx-1 mt-1 overflow-x-auto px-1">
        <table className="w-full min-w-[560px] table-fixed text-sm tabular-nums">
          <colgroup><col className="w-[34%]" /><col className="w-[15%]" /><col className="w-[9%]" /><col className="w-[19%]" /><col className="w-[9%]" /><col className="w-[14%]" /></colgroup>
          <thead>
            <tr className="border-b border-neutral-200">
              <TH align="left" label="Источник" />
              <TH sep label="Кол-во" unit="шт." />
              <TH label="Доля" unit={UNIT.pct} />
              <TH sep label="Сумма" unit={UNIT.rub} />
              <TH label="Доля" unit={UNIT.pct} />
              <TH sep label="Полоска доли" align="left" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => line(r.source, SOURCE_LABEL[r.source as PurchaseSource], r.qty, val(r), false, r.lots))}
            {hasDiff ? line("rounding", "округление", dQ, dV, true) : null}
            <tr className="row-total">
              <td className="py-1.5 pr-2 text-left">Всего (= «Куплено»)</td>
              <td className={cell + BL}>{formatQty(T.recvQty)} шт.</td>
              <td className={cell}>{formatPercent(T.recvQty > 0 ? 100 : 0)}</td>
              <td className={cell + BL}>{rub(T.recvValue)}</td>
              <td className={cell}>{formatPercent(T.recvValue > 0 ? 100 : 0)}</td>
              <td className={"px-1.5 py-1.5" + BL} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
