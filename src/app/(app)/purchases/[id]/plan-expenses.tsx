import { formatMoney } from "@/lib/utils";
import { planExpenseLines } from "@/lib/plan-expenses";

/**
 * Расходы, заложенные в расчёт лотов закупки (сборы аукциона, выделка, транспорт, таможня, упаковка, брокерский, транзит).
 * Показываются справочно: они уже входят в стоимость лотов, поэтому к итогу закупки отдельно не добавляются.
 */
export function PlanExpenses({ items }: { items: { quantity: unknown; vatRate?: unknown; costPlan: unknown }[] }) {
  const { lines, total } = planExpenseLines(items);
  if (lines.length === 0) return null;
  return (
    <div className="flex flex-col gap-1" data-plan-expenses>
      <div className="text-xs font-medium text-neutral-600">Расходы в расчёте лотов</div>
      <table className="w-full max-w-xl text-sm">
        <tbody>
          {lines.map((l) => (
            <tr key={l.key} className="border-b border-neutral-100">
              <td className="py-1 text-neutral-700">{l.label}</td>
              <td className="py-1 text-right tabular-nums">{formatMoney(l.incl.toFixed(2))}</td>
            </tr>
          ))}
          {lines.length > 1 && (
            <tr>
              <td className="py-1 font-semibold">Всего расходов, ₽ с НДС</td>
              <td className="py-1 text-right font-semibold tabular-nums">{formatMoney(total.toFixed(2))}</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="text-xs text-neutral-500">Эти расходы уже входят в стоимость лотов (расчёт позиции) и в итог закупки; отдельной строкой они не добавляются, поэтому двойного учёта нет.</p>
    </div>
  );
}
