import type { ReactNode } from "react";
import { Decimal } from "@prisma/client/runtime/library";
import { Money } from "@/components/money";
import { VatLabel } from "@/components/vat-label";
import { InfoHint } from "@/components/info-hint";
import { formatMoney, formatQty } from "@/lib/utils";

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
const z = (d: Decimal) => d.abs().lt(0.005);

function Cell({ label, on, off, big }: { label: ReactNode; on: Pair; off: Pair; big?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={(big ? "text-base font-semibold" : "font-medium") + " tabular-nums"}>{z(on.incl) ? "—" : <Money incl={on.incl} excl={on.excl} />}</div>
      {!z(on.incl) && !same(on, off) && (
        <div className="text-[11px] tabular-nums text-neutral-400">без 4%: <Money incl={off.incl} excl={off.excl} /></div>
      )}
    </div>
  );
}

/**
 * Итоги ТЗ в двух цифрах: «с 4%» (основная) и под ней мелко «без 4%», для меха, подкладки, итога, на 1 изделие и средневзвешенных цен.
 * Подписи НДС следуют переключателю «С НДС / Без НДС»; ставки НДС по строкам — «НДС 20%: X ₽ · 22%: Y ₽». Все суммы посчитаны на сервере теми же функциями, что Главная (commission4.ts, tz-vat.ts).
 */
export function CostSummary({
  fur, lining, expenses, work, hides, grand, perUnit, qty, qtyLabel, furGroups, liningGroup, vatRows, extra4, c4Hint,
}: {
  fur: { on: Pair; off: Pair };
  lining: { on: Pair; off: Pair } | null;
  expenses: Decimal;
  work: Decimal;
  hides: Pair | null;
  grand: { on: Pair; off: Pair };
  perUnit: { on: Pair; off: Pair } | null;
  qty: Decimal;
  qtyLabel: string;
  furGroups: WeightedGroup[];
  liningGroup: WeightedGroup | null;
  vatRows: { rate: number; vat: Decimal; incl: Decimal }[];
  extra4: Decimal;
  c4Hint: ReactNode;
}) {
  const plain = (d: Decimal): Pair => ({ incl: d, excl: d });
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
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm" id="cost-summary">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
        <Cell label={<VatLabel base="Мех · с 4%" />} on={fur.on} off={fur.off} />
        {lining ? <Cell label={<VatLabel base="Подкладка · с 4%" />} on={lining.on} off={lining.off} /> : null}
        <Cell label="Расходы" on={plain(expenses)} off={plain(expenses)} />
        <Cell label="Работа" on={plain(work)} off={plain(work)} />
        {hides ? <Cell label="Шкуры подрядчика" on={hides} off={hides} /> : null}
        <Cell label={<VatLabel base="Себестоимость ТЗ · с 4%" />} on={grand.on} off={grand.off} big />
        {perUnit ? <Cell label={`На 1 изд. · ${qtyLabel}`} on={perUnit.on} off={perUnit.off} /> : null}
      </div>
      <div className="flex flex-col gap-1 border-t border-neutral-100 pt-2 text-[13px]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-xs text-neutral-500">Средневзвешенное · расход на 1 изделие</span>
          <InfoHint label="Средневзвешенное" wide>
            <p>Цена за шкуру (м подкладки) = сумма по всем лотам ТЗ ÷ количество шкур (м), то есть взвешено по количеству. Расход на 1 изделие = количество шкур (м) ÷ количество изделий ({qtyLabel}). Основная цифра — с 4% (как в себестоимости), мелко — без 4%; с НДС или без — по переключателю шапки.</p>
            <p className="mt-1">Если в ТЗ несколько видов меха, они считаются отдельными строками. Те же цифры — в «Сырьё» и «Изделия».</p>
          </InfoHint>
          {c4Hint}
        </div>
        {furGroups.length === 0 && !liningGroup ? <span className="text-neutral-400">нет списаний</span> : null}
        {furGroups.map((g) => line(g, "шк.", "шк./изд."))}
        {liningGroup ? line(liningGroup, "м", "м/изд.") : null}
        <div className="flex flex-wrap items-baseline gap-x-3 text-xs text-neutral-500">
          <span>НДС в списаниях (с 4%):</span>
          {vatRows.length === 0 ? <span>—</span> : vatRows.map((r) => (
            <span key={r.rate} className="tabular-nums">НДС {r.rate}%: <b className="font-medium text-neutral-700">{formatMoney(r.vat.toFixed(0))}</b> из {formatMoney(r.incl.toFixed(0))}</span>
          ))}
          {!z(extra4) ? <span className="tabular-nums">· 4% добавляют {formatMoney(extra4.toFixed(0))}</span> : <span>· 4% не применяется</span>}
        </div>
      </div>
    </div>
  );
}
