"use client";

import Link from "next/link";
import { TH as Head } from "@/components/table-head";
import { useState } from "react";
import { Money } from "@/components/money";
import { TotalLabel } from "@/components/total-label";
import { formatPercent, formatQty } from "@/lib/utils";

export type ProdOrder = {
  orderId: string;
  number: string;
  /** Единая подпись ТЗ («ТЗ 182 · поз. 1/3»); number — внутренний номер для подсказки. */
  label: string;
  batchNumber: number | null;
  date: string | null;
  qty: number;
  produced: number;
  incl: string;
  excl: string;
  incl4: string;
  excl4: string;
};
export type ProdModel = {
  modelId: string;
  name: string;
  sku: string | null;
  category: string;
  group: string;
  orders: ProdOrder[];
};

const GROUPS = ["Все", "Одежда", "Аксессуары"] as const;
const TH = "px-1.5 py-1.5 text-right text-xs font-medium text-neutral-500 whitespace-nowrap";
const TD = "px-1.5 py-1.5 text-right tabular-nums whitespace-nowrap";
const dash = (v: number, f: (n: number) => string = (n) => formatQty(String(n))) => (Math.abs(v) < 0.0005 ? "—" : f(v));

const sum = (a: string[]) => a.reduce((s, x) => s + Number(x), 0);

/** «В каких изделиях участвует»: Артикул › ТЗ с долей лота и суммами. Данные приходят с сервера на каждый заход. */
export function LotProducts({ models, recv, unit }: { models: ProdModel[]; recv: number; unit: string }) {
  const [grp, setGrp] = useState<(typeof GROUPS)[number]>("Все");
  const shown = models.filter((m) => grp === "Все" || m.group === grp);
  const all = shown.flatMap((m) => m.orders);
  const tot = {
    qty: all.reduce((s, o) => s + o.qty, 0),
    produced: all.reduce((s, o) => s + o.produced, 0),
    incl: sum(all.map((o) => o.incl)), excl: sum(all.map((o) => o.excl)),
    incl4: sum(all.map((o) => o.incl4)), excl4: sum(all.map((o) => o.excl4)),
  };
  const share = (q: number) => (recv > 0 ? formatPercent((q / recv) * 100) : "—");
  const t = (n: number) => n.toFixed(2);
  const avg = (v: number, q: number) => (q > 0 ? t(v / q) : null);
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Группа изделий" className="inline-flex self-start overflow-hidden rounded-md border border-neutral-300 text-xs print:hidden">
        {GROUPS.map((g) => (
          <button key={g} type="button" aria-pressed={grp === g} onClick={() => setGrp(g)} className={"px-2.5 py-1 " + (grp === g ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 hover:bg-neutral-50")}>{g}</button>
        ))}
      </div>
      <div className="table-scroll scroll-hint overflow-x-auto rounded-lg border border-neutral-200 bg-white p-3">
        {shown.length === 0 ? (
          <p className="py-3 text-center text-sm text-neutral-500">{models.length === 0 ? "Лот пока не использован ни в одном ТЗ" : "В этой группе лот не использован"}</p>
        ) : (
          <table className="w-full min-w-[50rem] table-fixed text-left">
            <thead>
              <tr className="border-b border-neutral-200">
                <th className="w-[22%] px-1.5 py-1.5 text-left text-xs font-medium text-neutral-500">Артикул › ТЗ</th>
                <th className={TH + " w-[8%]"}>Партия</th>
                <th className={TH + " w-[9%]"}>Дата</th>
                <th className={TH + " w-[9%]"}>{unit === "м" ? "Метров" : "Шкур"}, {unit}</th>
                <th className={TH + " w-[8%]"}>Доля лота</th>
                <Head label="Сумма без 4%" unit="₽" align="right" className="w-[13%]" />
                <Head label="Сумма с 4%" unit="₽" align="right" className="w-[13%]" />
                <th className={TH + " w-[9%]"}>Ср. цена, ₽/{unit}</th>
                <th className={TH + " w-[9%]"}>На изделие, {unit}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => {
                const q = m.orders.reduce((s, o) => s + o.qty, 0);
                const pr = m.orders.reduce((s, o) => s + o.produced, 0);
                const i = sum(m.orders.map((o) => o.incl)), e = sum(m.orders.map((o) => o.excl));
                const i4 = sum(m.orders.map((o) => o.incl4)), e4 = sum(m.orders.map((o) => o.excl4));
                return [
                  <tr key={m.modelId} className="border-b border-neutral-100 bg-neutral-50/70 text-[13px] font-semibold">
                    <td className="px-1.5 py-1.5">
                      <Link href={`/models/${m.modelId}`} className="hover:underline">{m.sku ?? m.name}</Link>
                      <span className="block text-[11px] font-normal text-neutral-500">{m.name !== (m.sku ?? m.name) ? `${m.name} · ` : ""}{m.category}{m.group ? ` · ${m.group}` : ""}</span>
                    </td>
                    <td /><td />
                    <td className={TD}>{dash(q)}</td>
                    <td className={TD}>{share(q)}</td>
                    <td className={TD}><Money incl={t(i)} excl={t(e)} /></td>
                    <td className={TD}><Money incl={t(i4)} excl={t(e4)} /></td>
                    <td className={TD}>{avg(i, q) ? <Money incl={avg(i, q)!} excl={avg(e, q)!} /> : "—"}</td>
                    <td className={TD}>{pr > 0 ? formatQty((q / pr).toFixed(2)) : "—"}</td>
                  </tr>,
                  ...m.orders.map((o) => (
                    <tr key={o.orderId} className="border-b border-neutral-100 text-xs">
                      <td className="px-1.5 py-1.5 pl-5"><Link href={`/production/${o.orderId}`} className="text-blue-700 hover:underline" title={`Внутренний номер заказа ${o.number}`}>{o.label}</Link></td>
                      <td className={TD}>{o.batchNumber != null ? <Link href={`/production/batches/${o.batchNumber}`} className="hover:underline">{o.batchNumber}</Link> : "—"}</td>
                      <td className={TD}>{o.date ?? "—"}</td>
                      <td className={TD}>{dash(o.qty)}</td>
                      <td className={TD}>{share(o.qty)}</td>
                      <td className={TD}><Money incl={o.incl} excl={o.excl} /></td>
                      <td className={TD}><Money incl={o.incl4} excl={o.excl4} /></td>
                      <td className={TD}>{o.qty > 0 ? <Money incl={t(Number(o.incl) / o.qty)} excl={t(Number(o.excl) / o.qty)} /> : "—"}</td>
                      <td className={TD}>{o.produced > 0 ? formatQty((o.qty / o.produced).toFixed(2)) : "—"}</td>
                    </tr>
                  )),
                ];
              })}
              <tr className="row-total">
                <td className="px-1.5 py-1.5"><TotalLabel unit="₽" extra={`${all.length} ТЗ`} /></td>
                <td /><td />
                <td className={TD}>{dash(tot.qty)}</td>
                <td className={TD}>{share(tot.qty)}</td>
                <td className={TD}><Money incl={t(tot.incl)} excl={t(tot.excl)} /></td>
                <td className={TD}><Money incl={t(tot.incl4)} excl={t(tot.excl4)} /></td>
                <td className={TD}>{avg(tot.incl, tot.qty) ? <Money incl={avg(tot.incl, tot.qty)!} excl={avg(tot.excl, tot.qty)!} /> : "—"}</td>
                <td className={TD}>{tot.produced > 0 ? formatQty((tot.qty / tot.produced).toFixed(2)) : "—"}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
