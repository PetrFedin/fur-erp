import { Money } from "@/components/money";
import { LevelSummary, type LevelTile } from "@/components/level-summary";
import { formatMoney, formatDec1 } from "@/lib/utils";
import type { FlowFigures } from "@/lib/fur-table";
import type { LevelTotals } from "@/lib/mart/level-totals";

const pctOf =(part: number, whole: number) => (whole > 0 ? ` · ${Math.round((part / whole) * 100)} %` : "");

/**
 * Полоса итогов уровня из готовых цифр потока лотов (FlowFigures с обоими вариантами НДС): вид меха, год, любой срез лотов.
 * Режим «4 %» уже учтён в usedValue (figures считаются с режимом); «в т.ч. 4 %» показываем только когда режим включён.
 */
export function LevelSummaryFromFigures({ incl, excl, paid, due, c4, unit = "шт.", label }: { incl: FlowFigures; excl: FlowFigures; paid?: number | null; due?: number | null; c4: "on" | "off"; unit?: string; label?: string }) {
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
    ...(paid != null ? [{ key: "paid", title: "Оплачено", main: <span>{formatMoney(Math.round(paid))}</span>, lines: [{ k: "по лотам", v: "с НДС" }] } satisfies LevelTile] : []),
    ...(due != null ? [{ key: "debt", title: "Долг", tone: due > 0.5 ? ("warn" as const) : undefined, main: <span>{due > 0.5 ? formatMoney(Math.round(due)) : "0 ₽"}</span>, lines: [] } satisfies LevelTile] : []),
  ];
  return <LevelSummary tiles={tiles} label={label ?? "Итоги"} />;
}

/**
 * Полоса итогов уровня из витрины (LevelTotals): те же пять чисел, что везде. Режимы НДС и 4 % выбирают столбец;
 * оплаты и долг — из DmAuction и DmPurchase. payHref — ссылка «Оплаты →» (аукцион, закупка).
 */
export function LevelSummaryFromTotals({ t, c4, unit = "шт.", payHref, label }: { t: LevelTotals; c4: "on" | "off"; unit?: string; payHref?: string; label?: string }) {
  const on4 = c4 === "on";
  const q = unit === "м" ? "Метров" : "Шкур";
  const rubPer = unit === "м" ? "₽/м" : "₽/шт.";
  const per = (a: number, b: number, n: number) => (n > 0 ? <Money incl={(a / n).toFixed(2)} excl={(b / n).toFixed(2)} /> : "–");
  const usedI = t.incl.used + (on4 ? t.incl.extra : 0);
  const usedX = t.excl.used + (on4 ? t.excl.extra : 0);
  const tiles: LevelTile[] = [
    { key: "bought", title: "Куплено", main: <Money incl={t.incl.recv.toFixed(2)} excl={t.excl.recv.toFixed(2)} />, lines: [
      { k: q, v: `${formatDec1(String(t.qty.recv))} · лотов ${t.lots}` },
      { k: rubPer, v: per(t.incl.recv, t.excl.recv, t.qty.recv) },
      ...(t.usdAvg != null && unit !== "м" ? [{ k: "$/шт.", v: `$${Math.round(t.usdAvg).toLocaleString("ru-RU")}` }] : []),
    ] },
    { key: "used", title: "Использовано", main: <Money incl={usedI.toFixed(2)} excl={usedX.toFixed(2)} />, lines: [
      { k: q, v: `${formatDec1(String(t.qty.used))}${pctOf(t.qty.used, t.qty.recv)}` },
      { k: rubPer, v: per(usedI, usedX, t.qty.used) },
      ...(on4 && t.incl.extra > 0.5 ? [{ k: "в т.ч. 4 %", v: <Money incl={t.incl.extra.toFixed(2)} excl={t.excl.extra.toFixed(2)} /> }] : []),
    ] },
    { key: "rem", title: "Остаток", main: <Money incl={t.incl.rem.toFixed(2)} excl={t.excl.rem.toFixed(2)} />, lines: [
      { k: q, v: `${formatDec1(String(t.qty.rem))}${pctOf(t.qty.rem, t.qty.recv)}` },
      { k: rubPer, v: per(t.incl.rem, t.excl.rem, t.qty.rem) },
    ] },
  ];
  if (t.pay) {
    const r = t.pay.remaining;
    tiles.push({ key: "paid", title: "Оплачено", main: <span>{formatMoney(Math.round(t.pay.paid))}</span>, lines: [
      { k: "по счетам", v: formatMoney(Math.round(t.pay.total)) },
      ...(payHref ? [{ k: "", v: <a href={payHref} className="text-blue-600 hover:underline">Оплаты →</a> }] : []),
    ] });
    tiles.push({ key: "debt", title: r < -1 ? "Переплата" : "Долг", tone: r > 1 ? ("warn" as const) : undefined, main: <span>{Math.abs(r) < 1 ? "0 ₽" : formatMoney(Math.round(Math.abs(r)))}</span>, lines: [] });
  }
  return <LevelSummary tiles={tiles} label={label ?? "Итоги"} />;
}
