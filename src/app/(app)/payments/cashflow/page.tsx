import Link from "next/link";
import { requireSession } from "@/lib/session";
import { loadPaymentsOverview } from "@/lib/payments-overview";
import { buildCashflow, parsePeriod, type CashflowPeriod } from "@/lib/cashflow";
import { formatMoney } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import { PaymentsNav } from "../payments-nav";
import { CashflowView } from "./cashflow-view";

export const metadata = { title: "Cashflow" };

const PERIODS: [CashflowPeriod, string][] = [["all", "Все"], ["2025", "2025"], ["2026", "2026"]];

export default async function CashflowPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // requireSession без allowSupplier: внешнего поставщика (SUPPLIER) сюда не пускаем, как и на «Оплаты».
  const session = await requireSession();
  const sp = await searchParams;
  const period = parsePeriod(sp.p);
  const rows = await loadPaymentsOverview(session.user.organizationId);
  const d = buildCashflow(rows, period);
  const label = period === "all" ? "2025–2026" : period;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Cashflow</h1>
        <InfoHint label="Что такое Cashflow" align="right" wide>
          <p>Все проведённые оплаты («Оплачено» в разделе «Оплаты») по статьям и месяцам даты оплаты, с НДС. Планируемые и неподтверждённые к проведению платежи не входят.</p>
          <p className="mt-1">Итог за 2025–2026 равен «Оплачено всего» на странице «Оплаты».</p>
        </InfoHint>
      </div>
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <PaymentsNav tab="cashflow" />
        <nav aria-label="Период" className="inline-flex rounded-lg border border-neutral-300 bg-white p-0.5 text-sm">
          {PERIODS.map(([k, t]) => (
            <Link key={k} href={k === "all" ? "/payments/cashflow" : `/payments/cashflow?p=${k}`} aria-current={period === k ? "page" : undefined}
              className={"inline-flex min-h-11 items-center rounded-md px-3 " + (period === k ? "bg-neutral-900 text-white" : "text-neutral-700 hover:text-neutral-900")}>{t}</Link>
          ))}
        </nav>
      </div>
      <p className="text-sm">Потрачено за {label}: <b className="tabular-nums">{formatMoney(d.total)}</b></p>
      {d.outside > 0.5 && <p className="text-xs text-neutral-600">Оплаты вне 2025–2026 в таблицу не входят: {formatMoney(d.outside)}.</p>}
      <CashflowView months={d.months} articles={d.articles} monthTotals={d.monthTotals} cumulative={d.cumulative} total={d.total} periodLabel={label} />
    </div>
  );
}
