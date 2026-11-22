import { Money } from "@/components/money";
import { LevelSummary, type LevelTile } from "@/components/level-summary";
import { formatMoney, formatDec1 } from "@/lib/utils";
import type { FlowFigures } from "@/lib/fur-table";

const pctOf = (part: number, whole: number) => (whole > 0 ? ` · ${Math.round((part / whole) * 100)} %` : "");

/**
 * Полоса итогов уровня из готовых цифр потока лотов (FlowFigures с обоими вариантами НДС): вид меха, год, любой срез лотов.
 * Режим «4 %» уже учтён в usedValue (figures считаются с режимом); «в т.ч. 4 %» показываем только когда режим включён.
 */
export function LevelSummaryFromFigures({ incl, excl, paid, due, c4, unit = "шт.", label }: { incl: FlowFigures; excl: FlowFigures; paid: number; due: number; c4: "on" | "off"; unit?: string; label?: string }) {
  const on4 = c4 === "on";
  const extra = Math.abs(incl.usedValue - incl.usedValueOther);
  const extraX = Math.abs(excl.usedValue - excl.usedValueOther);
  const per = (a: number, b: number, q: number) => (q > 0 ? <Money incl={(a / q).toFixed(2)} excl={(b / q).toFixed(2)} /> : "–");
  const usd = (v: number | null | undefined) => (v != null && v > 0 ? `$${Math.round(v).toLocaleString("ru-RU")}` : null);
  const usdB = usd(incl.usdAvg), usdU = usd(incl.usdUsedAvg), usdR = usd(incl.usdRemAvg);
  const rubPer = unit === "м" ? "₽/м" : "₽/шт.";
  const tiles: LevelTile[] = [
    { key: "bought", title: "Куплено", main: <Money incl={incl.recvValue.toFixed(2)} excl={excl.recvValue.toFixed(2)} />, lines: [
      { k: unit === "м" ? "Метров" : "Шкур", v: formatDec1(String(incl.recvQty)) },
      { k: rubPer, v: per(incl.recvValue, excl.recvValue, incl.recvQty) },
      ...(usdB ? [{ k: "$/шт.", v: usdB }] : []),
    ] },
    { key: "used", title: "Использовано", main: <Money incl={incl.usedValue.toFixed(2)} excl={excl.usedValue.toFixed(2)} />, lines: [
      { k: unit === "м" ? "Метров" : "Шкур", v: `${formatDec1(String(incl.usedQty))}${pctOf(incl.usedQty, incl.recvQty)}` },
      { k: rubPer, v: per(incl.usedValue, excl.usedValue, incl.usedQty) },
      ...(usdU ? [{ k: "$/шт.", v: usdU }] : []),
      ...(on4 && extra > 0.5 ? [{ k: "в т.ч. 4 %", v: <Money incl={extra.toFixed(2)} excl={extraX.toFixed(2)} /> }] : []),
    ] },
    { key: "rem", title: "Остаток", main: <Money incl={incl.remValue.toFixed(2)} excl={excl.remValue.toFixed(2)} />, lines: [
      { k: unit === "м" ? "Метров" : "Шкур", v: `${formatDec1(String(incl.remQty))}${pctOf(incl.remQty, incl.recvQty)}` },
      { k: rubPer, v: per(incl.remValue, excl.remValue, incl.remQty) },
      ...(usdR ? [{ k: "$/шт.", v: usdR }] : []),
    ] },
    { key: "paid", title: "Оплачено", main: <span>{formatMoney(Math.round(paid))}</span>, lines: [{ k: "по лотам", v: "с НДС" }] },
    { key: "debt", title: "Долг", tone: due > 0.5 ? "warn" : undefined, main: <span>{due > 0.5 ? formatMoney(Math.round(due)) : "0 ₽"}</span>, lines: [] },
  ];
  return <LevelSummary tiles={tiles} label={label ?? "Итоги"} />;
}
