"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import type { OverviewRow } from "@/lib/payments-overview";
import { formatMoney } from "@/lib/utils";

const rub = (v: number) => (Math.abs(v) < 0.005 ? <span className="text-neutral-300">—</span> : formatMoney(v.toFixed(2)));
const fmtDate = (iso: string) => iso.split("-").reverse().join(".");
const sum = (rows: OverviewRow[], k: "fur" | "lining" | "work" | "hides" | "amount") => rows.reduce((a, r) => a + r[k], 0);

/** Раздел «Все»: всё, что мы оплатили — за сырьё и за производство, по годам и статьям; строка ведёт в нужный раздел. */
export function PaymentsOverview({ rows, c4, left }: { rows: OverviewRow[]; c4: number; left: { byYear: Record<number, { raw: number; prod: number }>; raw: number; prod: number } }) {
  const years = Array.from(new Set(rows.map((r) => r.year))).sort((a, b) => a - b);
  // Годы свёрнуты по умолчанию: итог по статьям виден, оплаты раскрываются по клику на год.
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (y: number) => setOpen((prev) => { const n = new Set(prev); if (n.has(y)) n.delete(y); else n.add(y); return n; });
  const head = (label: string, className = "") => <th className={"px-3 py-2 font-medium " + className}>{label}</th>;
  return (
    <div className="flex flex-col gap-4">
      {(() => {
        const rawPaid = sum(rows, "fur") + sum(rows, "lining");
        const workPaid = sum(rows, "work");
        const card = (label: string, value: number, rawV: number, workV: number, warn?: boolean) => (
          <div className="rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-sm">
            <div className="text-xs text-neutral-500">{label}</div>
            <div className={"mt-1 break-words text-base font-semibold tabular-nums sm:text-lg " + (warn && value > 0.5 ? "text-amber-700" : "")}>{formatMoney(value.toFixed(2))}</div>
            <div className="mt-0.5 text-xs text-neutral-500">сырьё <span className="tabular-nums">{formatMoney(rawV.toFixed(2))}</span> · работа <span className="tabular-nums">{formatMoney(workV.toFixed(2))}</span></div>
          </div>
        );
        return (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
            {card("К оплате", rawPaid + workPaid + left.raw + left.prod, rawPaid + left.raw, workPaid + left.prod)}
            {card("Оплачено", rawPaid + workPaid, rawPaid, workPaid)}
            {card("Остаток к оплате", left.raw + left.prod, left.raw, left.prod, true)}
          </div>
        );
      })()}

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full min-w-[1100px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
              {head("Год / оплата", "min-w-[280px]")}
              {head("Мех", "text-right")}
              {head("Подкладка", "text-right")}
              {head("Работа", "text-right")}
              {head("Оплачено", "text-right")}
              {head("Остаток за сырьё", "text-right")}
              {head("Остаток за работу", "text-right")}
              {head("Остаток всего", "text-right")}
            </tr>
          </thead>
          <tbody>
            {years.map((y) => {
              const list = rows.filter((r) => r.year === y);
              return (
                <Fragment key={y}>
                  <tr className="border-y border-neutral-300 bg-neutral-100 font-semibold">
                    <td className="px-3 py-2 text-base">
                      <button type="button" onClick={() => toggle(y)} aria-expanded={open.has(y)} className="inline-flex items-center gap-1.5 hover:text-blue-700">
                        <span aria-hidden className="text-xs">{open.has(y) ? "▾" : "▸"}</span>{y}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{rub(sum(list, "fur"))}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{rub(sum(list, "lining"))}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{rub(sum(list, "work"))}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(sum(list, "amount").toFixed(2))}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-amber-700">{rub(left.byYear[y]?.raw ?? 0)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-amber-700">{rub(left.byYear[y]?.prod ?? 0)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-amber-700">{rub((left.byYear[y]?.raw ?? 0) + (left.byYear[y]?.prod ?? 0))}</td>
                  </tr>
                  {open.has(y) && list.map((r) => (
                    <tr key={`${r.kind}-${r.id}`} className="border-b border-neutral-100">
                      <td className="px-3 py-1.5">
                        <Link href={r.href} className="text-blue-700 hover:underline" title={r.kind === "raw" ? "Открыть в разделе «За сырьё»" : "Открыть в разделе «За производство»"}>
                          {fmtDate(r.iso)} ›
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{rub(r.fur)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{rub(r.lining)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{rub(r.work)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right font-medium tabular-nums">{formatMoney(r.amount.toFixed(2))}</td>
                      <td /><td /><td />
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-neutral-400 bg-neutral-100 font-semibold">
              <td className="px-3 py-2">Итого за все годы</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{rub(sum(rows, "fur"))}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{rub(sum(rows, "lining"))}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{rub(sum(rows, "work"))}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(sum(rows, "amount").toFixed(2))}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-amber-700">{rub(left.raw)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-amber-700">{rub(left.prod)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-amber-700">{rub(left.raw + left.prod)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {c4 > 0.5 ? (
        <p className="text-xs text-neutral-500">
          Мех включает шкуры подрядчика, оплаченные в составе счетов за пошив. 4% за мех и подкладку, использованные в ТЗ ({formatMoney(c4.toFixed(2))}), уже учтены в этих оплатах и отдельной суммой не добавляются.
        </p>
      ) : null}
    </div>
  );
}
