import { Decimal } from "@prisma/client/runtime/library";
import { Money } from "@/components/money";
import { formatQty } from "@/lib/utils";

export type Pair = { incl: Decimal; excl: Decimal };
export type WeightedGroup = {
  name: string;
  unit: string;
  qty: Decimal;
  /** Сумма с 4% / без 4% (с НДС и без НДС). */
  on: Pair;
  off: Pair;
};

const same = (a: Pair, b: Pair) => a.incl.sub(b.incl).abs().lt(0.005) && a.excl.sub(b.excl).abs().lt(0.005);

/**
 * Средневзвешенные цены и расход на 1 изделие (мех — за шкуру, подкладка — за метр) в двух цифрах: «с 4%» (основная) и мелко «без 4%».
 * Итоги ТЗ (мех, подкладка, расходы, работа, себестоимость, на 1 изделие, НДС) показывают плитки «Итоги ТЗ» и итоговая строка таблицы списаний —
 * здесь они не повторяются. Подписи НДС следуют переключателю «С НДС / Без НДС». Суммы посчитаны на сервере теми же функциями, что Главная (commission4.ts).
 */
export function CostSummary({ qty, qtyLabel, furGroups, liningGroup, noUsages = false }: { qty: Decimal; qtyLabel: string; furGroups: WeightedGroup[]; liningGroup: WeightedGroup | null; noUsages?: boolean }) {
  const perItem = (g: WeightedGroup) => (qty.isZero() ? null : g.qty.div(qty));
  const avg = (g: WeightedGroup, k: "on" | "off") => (g.qty.isZero() ? null : { incl: g[k].incl.div(g.qty), excl: g[k].excl.div(g.qty) });
  const line = (g: WeightedGroup, unitShort: string, perLabel: string) => {
    const on = avg(g, "on");
    const off = avg(g, "off");
    const pi = perItem(g);
    return (
      <div key={g.name + unitShort} className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-neutral-500">{g.name}:</span>
        {on ? <b className="font-medium tabular-nums"><Money incl={on.incl} excl={on.excl} />/{unitShort}</b> : "—"}
        {on && off && !same(on, off) && <span className="text-[11px] text-neutral-400">без 4%: <Money incl={off.incl} excl={off.excl} />/{unitShort}</span>}
        <span className="text-neutral-400">·</span>
        <span className="tabular-nums">{formatQty(g.qty.toString())} {g.unit}{pi ? <> · <b className="font-medium">{formatQty(pi.toDecimalPlaces(2).toString())}</b> {perLabel}</> : null}</span>
      </div>
    );
  };
  return (
    <details className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm" id="cost-summary">
      <summary className="block-title cursor-pointer">Средневзвешенные цены и расход на 1 изделие</summary>
      <div className="mt-2 flex flex-col gap-1 text-[13px]">
        <p className="text-xs text-neutral-500">
          Цена за шкуру (м подкладки) = сумма по всем лотам ТЗ ÷ количество шкур (м). Расход на 1 изделие = количество шкур (м) ÷ количество изделий ({qtyLabel}). Основная цифра — с 4%, мелко — без 4%.
          {noUsages ? " В позиции нет списаний сырья со склада (лоскут, давальческое сырьё)." : ""}
        </p>
        {furGroups.length === 0 && !liningGroup ? <span className="text-neutral-400">нет списаний</span> : null}
        {furGroups.map((g) => line(g, "шк.", "шк./изд."))}
        {liningGroup ? line(liningGroup, "м", "м/изд.") : null}
      </div>
    </details>
  );
}
