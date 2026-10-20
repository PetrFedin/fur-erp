import Link from "next/link";
import { formatMoney, formatQty } from "@/lib/utils";

export type DecisionItem = { label: string; href: string; count?: number; sum?: number };

/** Одна узкая строка «Требует решения» под фильтрами: только если есть что решать; плюс одна ссылка в «Продажи и остатки». */
export function DecisionsStrip({ decisions }: { decisions: DecisionItem[] }) {
  return (
    <section aria-label="Требует решения" className="flex min-h-11 flex-wrap items-center gap-x-5 gap-y-0 rounded-lg border border-amber-300 bg-amber-50 px-3 py-0.5 print:hidden">
      {decisions.length > 0 ? <span className="text-sm font-semibold text-amber-900">Требует решения</span> : null}
      {decisions.map((x) => (
        <Link key={x.label} href={x.href} className="inline-flex min-h-11 items-center gap-2 text-sm text-amber-950 hover:underline">
          <span>{x.label}</span>
          {x.count ? <b className="tabular-nums">{x.count}</b> : null}
          {x.sum ? <b className="tabular-nums">{formatMoney(x.sum)}</b> : null}
          <span aria-hidden>→</span>
        </Link>
      ))}
      <Link href="/sales" data-testid="dash-sales-link" className="ml-auto inline-flex min-h-11 items-center text-sm text-blue-700 hover:underline">Продажи и остатки →</Link>
    </section>
  );
}

/** «Предоплачено, ждём поставку»: заказанное, но не принятое; в «Куплено», «Использовано» и «Остаток» не входит. Стоит внутри блока сырья. */
export function PrepaidLine({ qty, ordered, paid, due }: { qty: number; ordered: number; paid: number; due: number }) {
  if (ordered <= 0.5) return null;
  return (
    <p className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700" aria-label="Предоплачено, ждём поставку">
      <b>Предоплачено, ждём поставку:</b> заказано {formatMoney(ordered)} ({formatQty(qty)} шт.), предоплачено {formatMoney(paid)}, остаток к оплате {formatMoney(due)}; в «Куплено», «Использовано» и «Остаток» не входит.
      <Link href="/lots" className="ml-2 inline-flex min-h-11 items-center text-blue-700 hover:underline">В «Сырьё» →</Link>
    </p>
  );
}
