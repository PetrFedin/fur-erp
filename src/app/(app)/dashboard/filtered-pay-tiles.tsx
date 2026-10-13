import { formatMoney } from "@/lib/utils";
import type { FlowFigures } from "@/lib/fur-table";
import { InfoHint } from "@/components/info-hint";
import { TILE_BOX, TileHead, TileValue, TileList, type TileItem } from "./tile";

/**
 * Плитки оплат («Общая стоимость», «Оплачено», «К оплате») по выбранному срезу лотов — для таблицы «Мех / Подкладка» при фильтрах.
 * Деньги — доля оплат и долга аукциона по стоимости лота (так же, как строки «по сырью» на Главной при фильтрах); без фильтров
 * показываются плитки Главной (PayTiles) — их цифры не меняются. Разбивка «остаток / использовано / 4%» — как в PayTiles.
 */
export function FilteredPayTiles({ figs, paid, due, c4 }: { figs: FlowFigures; paid: number; due: number; c4: "on" | "off" }) {
  const money = (v: number) => formatMoney(v.toFixed(2));
  const dash = (v: number) => (Math.abs(v) < 0.5 ? "—" : money(v));
  const D = { stock: figs.remValue, used: c4 === "on" ? figs.usedValueOther : figs.usedValue, c4: Math.abs(figs.usedValue - figs.usedValueOther) };
  const split = (amount: number) => {
    const base = D.used + D.stock;
    const u = base > 0 ? D.used / base : 0;
    return { used: amount * u, stock: amount * (1 - u) };
  };
  const list = (s: { stock: number; used: number }, c4v: number): TileItem[] => [
    { k: "остаток на складе", v: dash(s.stock) },
    { k: "использовано", v: dash(s.used) },
    { k: "4%", v: dash(c4v) },
  ];
  const total = paid + due;
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
        <TileValue compact>{money(paid)}</TileValue>
        <div data-testid="paid-by-item"><TileList stack items={list(split(paid), D.c4)} /></div>
      </div>
      <div key="left" className={TILE_BOX} data-testid="debt-bridge">
        <TileHead>К оплате</TileHead>
        <TileValue compact className={due > 0.5 ? "text-amber-700" : ""}>{money(due)}</TileValue>
        <TileList stack items={list(split(due), 0)} />
      </div>
    </>
  );
}
