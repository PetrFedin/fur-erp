import { formatMoney } from "@/lib/utils";
import { alignFlowMoney, lrAllocate, roundRub } from "@/lib/money-round";
import { isDebtDust } from "@/lib/raw-rounding";
import type { FlowFigures } from "@/lib/fur-table";
import { InfoHint } from "@/components/info-hint";
import { TILE_BOX, TileHead, TileValue, TileList, type TileItem } from "./tile";

/**
 * Плитки оплат («Общая стоимость», «Оплачено», «К оплате») по выбранному срезу лотов — для таблицы «Мех / Подкладка» при фильтрах.
 * Деньги — доля оплат и долга аукциона по стоимости лота (так же, как строки «по сырью» на Главной при фильтрах); без фильтров
 * показываются плитки Главной (PayTiles) — их цифры не меняются. Разбивка «остаток / использовано / 4%» — как в PayTiles.
 */
export function FilteredPayTiles({ figs, paid, due, c4 }: { figs: FlowFigures; paid: number; due: number; c4: "on" | "off" }) {
  const money = (v: number) => formatMoney(roundRub(v));
  const dash = (v: number) => (Math.abs(v) < 0.5 ? "—" : money(v));
  // Целые рубли, сходящиеся на экране (src/lib/money-round.ts): оплачено + к оплате = общая стоимость, остаток + использовано = их части.
  const fa = alignFlowMoney(figs, c4 === "on");
  const D = { stock: fa.remValue, used: c4 === "on" ? fa.usedValueOther : fa.usedValue, c4: Math.abs(fa.usedValue - fa.usedValueOther) };
  const [paidR, dueR] = lrAllocate([paid, due]);
  const split = (amount: number, shown: number) => {
    const base = D.used + D.stock;
    const u = base > 0 ? D.used / base : 0;
    const [used, stock] = lrAllocate([amount * u, amount * (1 - u)], shown);
    return { used, stock };
  };
  const list = (s: { stock: number; used: number }, c4v: number): TileItem[] => [
    { k: "остаток на складе", v: dash(s.stock) },
    { k: "использовано", v: dash(s.used) },
    { k: "4%", v: dash(c4v) },
  ];
  const total = paidR + dueR;
  return (
    <>
      <div key="total" className={TILE_BOX}>
        <TileHead>Общая стоимость</TileHead>
        <div className="absolute right-3 top-3">
          <InfoHint label="Что такое общая стоимость" align="right">
            <p>Оплачено плюс осталось оплатить по выбранным лотам. Всегда с НДС; 4% отдельно не добавляются.</p>
            <p className="mt-1">Оплаты и долг партии закупки делятся между её лотами пропорционально стоимости лота.</p>
          </InfoHint>
        </div>
        <TileValue compact>{money(total)}</TileValue>
        <TileList stack items={list({ stock: D.stock, used: D.used }, D.c4)} />
      </div>
      <div key="paid" className={TILE_BOX}>
        <TileHead>Оплачено</TileHead>
        <TileValue compact>{money(paidR)}</TileValue>
        <div data-testid="paid-by-item"><TileList stack items={list(split(paid, paidR), D.c4)} /></div>
      </div>
      <div key="left" className={TILE_BOX} data-testid="debt-bridge">
        <TileHead>К оплате</TileHead>
        {isDebtDust(due) ? (
          <>
            <TileValue compact><span title={`округление (${money(due)})`}>—</span></TileValue>
            <div className="text-xs text-neutral-500">округление ({money(due)})</div>
          </>
        ) : (
          <>
            <TileValue compact className={due > 0.5 ? "text-amber-700" : ""}>{money(dueR)}</TileValue>
            <TileList stack items={list(split(due, dueR), 0)} />
          </>
        )}
      </div>
    </>
  );
}
