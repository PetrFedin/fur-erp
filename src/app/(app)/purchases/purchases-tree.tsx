"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { formatMoney } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import { ARROW_TD, ARROW_TH, Chevron, Dash, INDENT, SCROLL_BOX, TD, TH, TH_LEFT, rowTone } from "@/components/tree-table";
import { TotalLabel } from "@/components/total-label";

export type TreeItem = { id: string; lotId: string | null; label: string; lot: string | null; qty: string; sum: number };
export type TreeExpense = { id: string; label: string; sum: number };
export type TreePay = { id: string; date: string; amount: number; doc: string | null };
export type TreePurchase = {
  id: string; number: string; date: string; supplier: string; invoice: string | null; cancelled: boolean; received: boolean;
  total: number; paid: number; rest: number;
  /** Часть «Оплачено», пришедшая из оплат партии целиком (не привязанных к закупке). */
  paidBatch: number;
  items: TreeItem[]; expenses: TreeExpense[]; pays: TreePay[];
};
export type TreeBatch = { key: string; label: string; title?: string; href?: string; purchases: TreePurchase[] };
export type TreeYear = { year: number; batches: TreeBatch[] };

const m = (v: number) => (Math.abs(v) < 0.005 ? <Dash /> : formatMoney(v.toFixed(2)));
const sum = (list: TreePurchase[], k: "total" | "paid" | "rest") => list.reduce((a, p) => a + (p.cancelled ? 0 : p[k]), 0);
const restCls = (v: number) => (v > 0.5 ? " text-amber-700" : v < -0.5 ? " text-emerald-700" : "");

/**
 * Закупки по годам и партиям: год → партия закупки (аукцион) → закупка → позиции / расходы / оплаты.
 * Те же суммы, что в списке и в карточке закупки; итог совпадает с плитками (шкуры подрядчика — отдельной строкой).
 */
export function PurchasesTree({ years, hides }: { years: TreeYear[]; hides: number }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const flip = (set: Set<string>, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n; };
  const arrow = (isOpen: boolean, onClick: () => void, label: string) => (
    <button type="button" onClick={onClick} aria-expanded={isOpen} aria-label={`Раскрыть: ${label}`}><Chevron open={isOpen} /></button>
  );
  const figs = (v: { total: number; paid: number; rest: number }, qty?: string) => (
    <>
      <td className={TD + " text-neutral-500"}>{qty ?? ""}</td>
      <td className={TD + " border-l border-neutral-100"}>{m(v.total)}</td>
      <td className={TD}>{m(v.paid)}</td>
      <td className={TD + restCls(v.rest)}>{m(v.rest)}</td>
    </>
  );
  const all = years.flatMap((y) => y.batches.flatMap((b) => b.purchases));
  const cnt = (n: number, one: string, few: string, many: string) => `${n} ${n === 1 ? one : n < 5 ? few : many}`;

  return (
    <section aria-labelledby="pur-tree" className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 id="pur-tree" className="text-base font-semibold">Закупки по годам и партиям</h2>
        <InfoHint label="Как читать таблицу закупок" wide>
          <p><b>Год → партия закупки (аукцион) → закупка → позиции, расходы, оплаты.</b> Год — по дате заказа закупки. Нажмите ›, чтобы раскрыть вглубь; номер закупки ведёт в её карточку, а оттуда — к лотам и оплатам.</p>
          <p className="mt-1"><b>Сумма</b> — позиции с НДС плюс расходы закупки; <b>Оплачено</b> — оплаты закупки и её доля в оплатах партии (пропорционально сумме); <b>Задолженность</b> = Сумма − Оплачено. Всегда с НДС; 4% к закупкам не применяется.</p>
          <p className="mt-1">«Всего, ₽» совпадает с плитками выше и с Главной. Отменённые закупки в итог не входят.</p>
        </InfoHint>
      </div>
      <div className={SCROLL_BOX}>
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className={ARROW_TH} aria-label="Раскрыть" />
              <th className={TH_LEFT}>Год / партия / закупка</th>
              <th className={TH}>Кол-во</th>
              <th className={TH + " border-l border-neutral-100"}>Сумма</th>
              <th className={TH}>Оплачено</th>
              <th className={TH}>Задолженность</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => {
              const yk = `y${y.year}`;
              const yOpen = !closed.has(yk);
              const list = y.batches.flatMap((b) => b.purchases);
              return (
                <Fragment key={yk}>
                  <tr className={rowTone(0) + " font-semibold"}>
                    <td className={ARROW_TD}>{arrow(yOpen, () => setClosed((s) => flip(s, yk)), String(y.year))}</td>
                    <td className="px-2 py-1.5 text-left">{y.year}<span className="ml-1.5 text-xs font-normal text-neutral-500">{cnt(list.filter((p) => !p.cancelled).length, "закупка", "закупки", "закупок")}</span></td>
                    {figs({ total: sum(list, "total"), paid: sum(list, "paid"), rest: sum(list, "rest") })}
                  </tr>
                  {yOpen ? y.batches.map((b) => {
                    const bk = `${yk}:${b.key}`;
                    const bOpen = open.has(bk);
                    return (
                      <Fragment key={bk}>
                        <tr className={rowTone(1, bOpen)}>
                          <td className={ARROW_TD}>{arrow(bOpen, () => setOpen((s) => flip(s, bk)), b.label)}</td>
                          <td className={`py-1.5 pr-2 text-left ${INDENT[0]}`} title={b.title}>
                            {b.label}
                            <span className="ml-1.5 text-xs text-neutral-500">{cnt(b.purchases.length, "закупка", "закупки", "закупок")}</span>
                            {b.href ? <Link href={b.href} className="ml-2 text-xs text-blue-700 hover:underline">оплаты партии ›</Link> : null}
                          </td>
                          {figs({ total: sum(b.purchases, "total"), paid: sum(b.purchases, "paid"), rest: sum(b.purchases, "rest") })}
                        </tr>
                        {bOpen ? b.purchases.map((p) => {
                          const pk = `${bk}:${p.id}`;
                          const pOpen = open.has(pk);
                          return (
                            <Fragment key={pk}>
                              <tr className={rowTone(2, pOpen) + (p.cancelled ? " opacity-60" : "")}>
                                <td className={ARROW_TD}>{arrow(pOpen, () => setOpen((s) => flip(s, pk)), p.number)}</td>
                                <td className={`py-1.5 pr-2 text-left ${INDENT[1]}`}>
                                  <Link href={`/purchases/${p.id}`} className="text-blue-700 hover:underline">{p.number}</Link>
                                  <span className="ml-2 tabular-nums text-neutral-500">{p.date}</span>
                                  {multiSupplier(all) ? <span className="ml-2 text-neutral-500">{p.supplier}</span> : null}
                                  {p.invoice ? <span className="ml-2 text-neutral-500">счёт {p.invoice}</span> : null}
                                  {p.cancelled ? <span className="ml-2 text-neutral-500">отменена</span> : !p.received ? <span className="ml-2 text-amber-700">черновик</span> : null}
                                </td>
                                {figs(p.cancelled ? { total: 0, paid: 0, rest: 0 } : p)}
                              </tr>
                              {pOpen ? (
                                <>
                                  {([
                                    ["items", "Позиции", p.items.length, p.items.reduce((a, x) => a + x.sum, 0), null],
                                    ["exp", "Расходы закупки", p.expenses.length, p.expenses.reduce((a, x) => a + x.sum, 0), null],
                                    ["pay", "Оплаты", p.pays.length + (Math.abs(p.paidBatch) > 0.5 ? 1 : 0), null, p.paid],
                                  ] as const).map(([g, label, n, total, paid]) => {
                                    const gk = `${pk}:${g}`;
                                    const gOpen = open.has(gk);
                                    return (
                                      <Fragment key={gk}>
                                        <tr className={rowTone(2, gOpen)}>
                                          <td className={ARROW_TD}>{n > 0 ? arrow(gOpen, () => setOpen((s) => flip(s, gk)), label) : null}</td>
                                          <td className={`py-1.5 pr-2 text-left ${INDENT[2]}`}>{label}<span className="ml-1.5 text-neutral-500">{n > 0 ? n : "нет"}</span></td>
                                          <td className={TD} />
                                          <td className={TD + " border-l border-neutral-100"}>{total != null ? m(total) : <Dash />}</td>
                                          <td className={TD}>{paid != null ? m(paid) : <Dash />}</td>
                                          <td className={TD} />
                                        </tr>
                                        {gOpen && g === "items" ? p.items.map((x) => (
                                          <tr key={x.id} className={rowTone(3)}>
                                            <td className={ARROW_TD} />
                                            <td className={`py-1.5 pr-2 text-left ${INDENT[3]}`}>{x.label}{x.lot ? <span className="ml-1.5 text-neutral-400">лот № {x.lot}</span> : null}{x.lotId ? <Link href={`/analytics/raw/lot/${x.lotId}`} className="ml-2 text-blue-700 hover:underline">карточка лота ›</Link> : null}</td>
                                            <td className={TD}>{x.qty}</td>
                                            <td className={TD + " border-l border-neutral-100"}>{m(x.sum)}</td>
                                            <td className={TD} /><td className={TD} />
                                          </tr>
                                        )) : null}
                                        {gOpen && g === "exp" ? p.expenses.map((x) => (
                                          <tr key={x.id} className={rowTone(3)}>
                                            <td className={ARROW_TD} />
                                            <td className={`py-1.5 pr-2 text-left ${INDENT[3]}`}>{x.label}</td>
                                            <td className={TD} />
                                            <td className={TD + " border-l border-neutral-100"}>{m(x.sum)}</td>
                                            <td className={TD} /><td className={TD} />
                                          </tr>
                                        )) : null}
                                        {gOpen && g === "pay" ? (
                                          <>
                                            {p.pays.map((x) => (
                                              <tr key={x.id} className={rowTone(3)}>
                                                <td className={ARROW_TD} />
                                                <td className={`py-1.5 pr-2 text-left ${INDENT[3]}`}><span className="tabular-nums">{x.date}</span>{x.doc ? <span className="ml-2 text-neutral-500">{x.doc}</span> : null}</td>
                                                <td className={TD} /><td className={TD + " border-l border-neutral-100"} />
                                                <td className={TD}>{m(x.amount)}</td><td className={TD} />
                                              </tr>
                                            ))}
                                            {Math.abs(p.paidBatch) > 0.5 ? (
                                              <tr className={rowTone(3)}>
                                                <td className={ARROW_TD} />
                                                <td className={`py-1.5 pr-2 text-left ${INDENT[3]}`}>Остальные оплаты партии<span className="ml-1.5 text-neutral-400">доля закупки, пропорционально сумме</span></td>
                                                <td className={TD} /><td className={TD + " border-l border-neutral-100"} />
                                                <td className={TD}>{m(p.paidBatch)}</td><td className={TD} />
                                              </tr>
                                            ) : null}
                                          </>
                                        ) : null}
                                      </Fragment>
                                    );
                                  })}
                                </>
                              ) : null}
                            </Fragment>
                          );
                        }) : null}
                      </Fragment>
                    );
                  }) : null}
                </Fragment>
              );
            })}
            {years.length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-neutral-500">Закупок нет.</td></tr> : null}
            {hides > 0.5 ? (
              <tr className={rowTone(1)}>
                <td className={ARROW_TD} />
                <td className={`py-1.5 pr-2 text-left ${INDENT[0]}`}>Шкуры подрядчика<span className="ml-1.5 text-neutral-500">оплачены в составе счетов за пошив</span></td>
                <td className={TD} />
                <td className={TD + " border-l border-neutral-100"}>{m(hides)}</td>
                <td className={TD}>{m(hides)}</td>
                <td className={TD}><Dash /></td>
              </tr>
            ) : null}
            {years.length > 0 ? (
              <tr className="row-total">
                <td className={ARROW_TD} />
                <td className="px-2 py-1.5 text-left"><TotalLabel /></td>
                {figs({ total: sum(all, "total") + hides, paid: sum(all, "paid") + hides, rest: sum(all, "rest") })}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function multiSupplier(all: TreePurchase[]) {
  return new Set(all.map((p) => p.supplier)).size > 1;
}
