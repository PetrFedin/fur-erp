import Link from "next/link";
import { InfoHint } from "@/components/info-hint";
import { formatPercent } from "@/lib/utils";
import type { YearFilter } from "@/lib/year-filter";
import type { ControlCounts } from "@/lib/control-counts";
import { calcInvoice, totalsOf, visibleFor } from "../reconciliation/model";
import { formatCompactMoney } from "./compact";

/**
 * «Надёжность данных»: сколько оплат по счетам Веллмех подтверждено и сколько под вопросом.
 * Числа берутся из той же сверки (reconciliation/model: visibleFor → calcInvoice → totalsOf), что и страница «Сверка»; здесь ничего не пересчитывается.
 */
export function ReliabilityBlock({ year, control }: { year: YearFilter; control: ControlCounts | null }) {
  const { invs } = visibleFor(year);
  const t = totalsOf(invs.map((i) => calcInvoice(i)));
  const m = formatCompactMoney;
  const doubt = Math.max(0, t.amount - t.paid);
  const row = "flex items-baseline justify-between gap-3";
  return (
    <section aria-label="Надёжность данных" className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1 text-sm font-semibold text-neutral-900">
          Надёжность данных
          <InfoHint label="Что значат эти числа" wide>
            <p>Счета посредника (Веллмех): сколько денег по ним подтверждено платёжными документами, письмом «оплачено» и сколько пока не подтверждено. Те же числа, что на странице «Сверка».</p>
            <p className="mt-1">Подтверждено — оплачено по документам и по письму поставщика. Под вопросом — счета, по которым пока есть только «согласовано» или нет никаких подтверждений.</p>
          </InfoHint>
        </h2>
        <Link href="/reconciliation" className="text-xs text-blue-700 hover:underline">→ Сверка</Link>
      </div>
      <div className="text-xs text-neutral-700">
        <div className="mb-1 h-2 overflow-hidden rounded-full bg-neutral-200" aria-hidden><div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, t.pct)}%` }} /></div>
        <div className={row}><span>Подтверждено документами</span><b className="tabular-nums">{m(t.paidDocs)}</b></div>
        <div className={row}><span>Подтверждено письмом поставщика</span><b className="tabular-nums">{m(t.paidLetter)}</b></div>
        <div className={row}><span>Всего подтверждено ({formatPercent(t.pct)} от {m(t.amount)})</span><b className="tabular-nums text-emerald-700">{m(t.paid)}</b></div>
        <div className={row}><span>Под вопросом (пока не подтверждено)</span><b className="tabular-nums text-amber-700">{m(doubt)}</b></div>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-neutral-100 pt-1.5 text-xs text-neutral-700">
        <span>Открытых задач и вопросов к владельцу: <b className="tabular-nums">{control ? control.tasks : "—"}</b>{control && control.decisions > 0 ? <span className="text-neutral-500"> (из них решений владельца — {control.decisions})</span> : null}</span>
        <Link href="/attention" className="text-blue-700 hover:underline">→ Контроль</Link>
      </div>
    </section>
  );
}
