"use client";

import Link from "next/link";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import type { FlowFigures } from "@/lib/fur-table";
import { formatCompactMoney } from "./compact";
import { prodSummary, type ProdNums } from "./production-block";

type Pair = { incl: FlowFigures; excl: FlowFigures };

export type StripPay = {
  /** Работа по ТЗ: оплачено и к оплате (начислено = сумма). */
  workPaid: number; workLeft: number;
  /** Сырьё (мех + подкладка): оплачено поставщикам и долг. */
  rawPaid: number; rawLeft: number;
  /** Общий долг (сырьё + работа). */
  totalLeft: number;
  overdueCount: number; overdueSum: number;
};

function Cell({ href, label, value, sub, title, tone }: { href: string; label: string; value: string; sub?: string; title?: string; tone?: string }) {
  return (
    <Link href={href} title={title} className="tile-click block min-w-0 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700">
      <div className="text-[11px] leading-4 text-neutral-500">{label}</div>
      <div className={"break-words text-base font-semibold leading-6 tabular-nums " + (tone ?? "text-neutral-900")}>{value}</div>
      <div className="min-h-4 break-words text-[11px] leading-4 text-neutral-500">{sub ?? ""}</div>
    </Link>
  );
}

/**
 * Полоса «Главное»: ключевые числа одним взглядом. Каждое число — из тех же расчётов, что и блоки ниже
 * (Сырьё, Производство, Оплаты), ничего нового не считается. Клик ведёт в раздел с теми же фильтрами.
 */
export function MainStrip({ fur, lining, c4, prod, hides, pay, hrefs }: {
  fur: Pair; lining: Pair; c4: "on" | "off";
  prod: { done: ProdNums; work: ProdNums; all: ProdNums };
  hides: { incl: number; excl: number };
  pay: StripPay;
  hrefs: { fur: string; lining: string; prod: string; pay: string };
}) {
  const { mode: vat } = useVatDisplay();
  const F = fur[vat], L = lining[vat];
  const m = (v: number) => formatCompactMoney(v);
  const full = (v: number) => formatMoney(v.toFixed(2));
  // «Использовано» — без 4%, как в плитке «Сырьё».
  const furUsed = c4 === "on" ? F.usedValueOther : F.usedValue;
  const ps = prodSummary(prod.done, prod.work, prod.all, hides, vat);
  const workAll = pay.workPaid + pay.workLeft;
  const vatW = vat === "incl" ? "с НДС" : "без НДС";
  return (
    <section aria-label="Главное" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-sm font-semibold text-neutral-900">Главное</h2>
        <span className="text-xs text-neutral-500">Сырьё и себестоимость — {vatW}; деньги по оплатам — всегда с НДС. Учитывает год и фильтры ниже. Нажмите на число — откроется раздел.</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <Cell href={hrefs.fur} label="Мех куплено" value={m(F.recvValue)} sub={`${formatQty(F.recvQty)} шт.`} title={full(F.recvValue)} />
        <Cell href={hrefs.fur} label="Мех использован в ТЗ" value={m(furUsed)} sub={`${formatQty(F.usedQty)} шт. · без 4%`} title={full(furUsed)} />
        <Cell href={hrefs.fur} label="Мех остаётся на складе" value={m(F.remValue)} sub={`${formatQty(F.remQty)} шт.`} title={full(F.remValue)} />
        <Cell href={hrefs.lining} label="Подкладка куплено" value={m(L.recvValue)} sub={`${formatQty(L.recvQty)} м · остаётся ${formatQty(L.remQty)} м, ${m(L.remValue)}`} title={full(L.recvValue)} />
        <Cell href={hrefs.prod} label="Произведено" value={`${formatQty(ps.qty)} шт.`} sub="по всем ТЗ, без ремонта" />
        <Cell href={hrefs.prod} label="Себестоимость произведённого" value={m(ps.total)} sub="сырьё + расходы + работа" title={full(ps.total)} />
        <Cell href={hrefs.prod} label="Себестоимость одного изделия" value={ps.avg != null ? full(ps.avg) : "—"} sub="без работы" />
        <Cell href={hrefs.pay} label="Работа по ТЗ начислена" value={m(workAll)} sub={`оплачено ${m(pay.workPaid)} · к оплате ${m(pay.workLeft)}`} title={full(workAll)} />
        <Cell href={hrefs.pay} label="Оплачено поставщикам сырья" value={m(pay.rawPaid)} sub="мех и подкладка" title={full(pay.rawPaid)} />
        <Cell href={hrefs.pay} label="Долг по сырью" value={m(pay.rawLeft)} sub="ещё нужно заплатить" title={full(pay.rawLeft)} tone={pay.rawLeft > 0 ? "text-amber-700" : undefined} />
        <Cell href={hrefs.pay} label="Общий долг" value={m(pay.totalLeft)} sub="сырьё + работа" title={full(pay.totalLeft)} tone={pay.totalLeft > 0 ? "text-amber-700" : undefined} />
        <Cell href={hrefs.pay} label="Просрочено по счетам" value={pay.overdueCount > 0 ? m(pay.overdueSum) : "нет"} sub={pay.overdueCount > 0 ? `${pay.overdueCount} шт., срок прошёл` : "сроки не нарушены"} tone={pay.overdueCount > 0 ? "text-red-700" : undefined} />
      </div>
    </section>
  );
}
