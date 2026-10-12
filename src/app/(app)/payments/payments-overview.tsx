"use client";

import Link from "next/link";
import { Fragment, useState, type ReactNode } from "react";
import type { OverviewRow } from "@/lib/payments-overview";
import { formatMoney } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import { ARROW_TD, ARROW_TH, Chevron, Dash, INDENT, SCROLL_BOX, TD, TH, TH_LEFT, rowTone } from "@/components/tree-table";
import { TotalLabel } from "@/components/total-label";

const fmtDate = (iso: string) => iso.split("-").reverse().join(".");
const sum = (rows: OverviewRow[], k: "fur" | "lining" | "work" | "hides" | "amount") => rows.reduce((a, r) => a + r[k], 0);
const m = (v: number) => (Math.abs(v) < 0.005 ? <Dash /> : formatMoney(v.toFixed(2)));

type Left = { byYear: Record<number, { raw: number; prod: number }>; raw: number; prod: number };

/**
 * Раздел «Все»: всё, что оплачено — за сырьё и за производство. Год → вид (сырьё / производство) → оплата → распределение
 * (по закупкам партии или по ТЗ). Плитки сверху — те же, что на Главной (передаются готовыми).
 */
export function PaymentsOverview({ tiles, rows, left, controls }: { tiles: ReactNode; rows: OverviewRow[]; left: Left; controls: Record<string, ReactNode> }) {
  const years = Array.from(new Set([...rows.map((r) => r.year), ...Object.keys(left.byYear).map(Number)])).sort((a, b) => a - b);
  // Годы развёрнуты до вида (сырьё / производство); оплаты и распределение раскрываются по клику.
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const flip = (set: Set<string>, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n; };
  const toggleClosed = (k: string) => setClosed((s) => flip(s, k));
  const toggle = (k: string) => setOpen((s) => flip(s, k));

  const arrow = (isOpen: boolean, onClick: () => void, label: string) => (
    <button type="button" onClick={onClick} aria-expanded={isOpen} aria-label={`Раскрыть: ${label}`}><Chevron open={isOpen} /></button>
  );
  const debtTd = (v: number, cls = "") => <td className={TD + cls + (v > 0.5 ? " text-amber-700" : "")}>{m(v)}</td>;
  const figures = (r: { fur: number; lining: number; work: number; paid: number; debt: number | null }, cls = "") => (
    <>
      <td className={TD + " border-l border-neutral-200" + cls}>{m(r.fur)}</td>
      <td className={TD + cls}>{m(r.lining)}</td>
      <td className={TD + cls}>{m(r.work)}</td>
      <td className={TD + " border-l border-neutral-200" + cls}>{m(r.paid)}</td>
      {r.debt == null ? <td className={TD}><Dash /></td> : debtTd(r.debt, cls)}
    </>
  );

  const yearBlock = (y: number) => {
    const list = rows.filter((r) => r.year === y);
    const raw = list.filter((r) => r.kind === "raw");
    const prod = list.filter((r) => r.kind === "prod");
    const l = left.byYear[y] ?? { raw: 0, prod: 0 };
    const yk = `y${y}`;
    const yOpen = !closed.has(yk);
    const kinds = [
      { kind: "raw" as const, label: "За сырьё", list: raw, debt: l.raw },
      { kind: "prod" as const, label: "За производство", list: prod, debt: l.prod },
    ].filter((k) => k.list.length > 0 || k.debt > 0.5);
    return (
      <Fragment key={y}>
        <tr className={rowTone(0) + " font-semibold"}>
          <td className={ARROW_TD}>{arrow(yOpen, () => toggleClosed(yk), String(y))}</td>
          <td className="px-2 py-1.5 text-left">{y}</td>
          {figures({ fur: sum(list, "fur"), lining: sum(list, "lining"), work: sum(list, "work"), paid: sum(list, "amount"), debt: l.raw + l.prod })}
        </tr>
        {yOpen ? kinds.map((k) => {
          const kk = `${yk}:${k.kind}`;
          const kOpen = open.has(kk);
          return (
            <Fragment key={kk}>
              <tr className={rowTone(1, kOpen)}>
                <td className={ARROW_TD}>{k.list.length > 0 ? arrow(kOpen, () => toggle(kk), k.label) : null}</td>
                <td className={`py-1.5 pr-2 text-left ${INDENT[0]}`}>{k.label}<span className="ml-1.5 text-xs text-neutral-500">{k.list.length > 0 ? `${k.list.length} ${k.list.length === 1 ? "оплата" : k.list.length < 5 ? "оплаты" : "оплат"}` : "оплат нет"}</span></td>
                {figures({ fur: sum(k.list, "fur"), lining: sum(k.list, "lining"), work: sum(k.list, "work"), paid: sum(k.list, "amount"), debt: k.debt })}
              </tr>
              {kOpen ? k.list.map((r) => {
                const pk = `p:${r.id}`;
                const pOpen = open.has(pk);
                return (
                  <Fragment key={pk}>
                    <tr className={rowTone(2, pOpen)}>
                      <td className={ARROW_TD}>{arrow(pOpen, () => toggle(pk), `оплата ${fmtDate(r.iso)}`)}</td>
                      <td className={`py-1.5 pr-2 text-left ${INDENT[1]}`}>
                        <span className="tabular-nums">{fmtDate(r.iso)}</span>
                        <span className="ml-2">{r.what}</span>
                        <span className="ml-2 text-neutral-500">{r.label}</span>
                        {!r.confirmed ? <span className="ml-2 text-amber-700" title="Нет платёжки: оплата не подтверждена">ждёт проверки</span> : null}
                        <Link href={r.links[0]?.href ?? r.href} title="Открыть закупку / ТЗ / партию" className="ml-2 text-[11px] text-neutral-500 hover:underline">↗ {r.links[0]?.label ?? (r.kind === "raw" ? "За сырьё" : "За производство")}</Link>
                        {r.doc ? <div className="mt-0.5 max-w-[34rem] truncate text-xs text-neutral-500" title={r.doc}>{r.doc}</div> : null}
                      </td>
                      {figures({ fur: r.fur, lining: r.lining, work: r.work, paid: r.amount, debt: null })}
                    </tr>
                    {pOpen ? (
                      <tr className={rowTone(3)}>
                        <td className={ARROW_TD} />
                        <td colSpan={6} className={`py-2 pr-3 text-left text-xs ${INDENT[2]}`}>
                          <dl className="grid max-w-3xl grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-[max-content_1fr]">
                            {r.fields.map(([k, v]) => (
                              <Fragment key={k}>
                                <dt className="text-neutral-500">{k}</dt>
                                <dd className="break-words tabular-nums text-neutral-800">{v}</dd>
                              </Fragment>
                            ))}
                          </dl>
                          {r.links.length > 0 ? (
                            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                              {r.links.map((l) => <Link key={l.href} href={l.href} className="text-blue-700 hover:underline">{l.label} →</Link>)}
                            </div>
                          ) : null}
                          {controls[r.id] ? <div className="mt-2">{controls[r.id]}</div> : null}
                        </td>
                      </tr>
                    ) : null}
                    {pOpen ? r.parts.map((x, i) => (
                      <tr key={`${pk}:${i}`} className={rowTone(3)}>
                        <td className={ARROW_TD} />
                        <td className={`py-1.5 pr-2 text-left ${INDENT[2]}`}>
                          {x.href ? <Link href={x.href} className="text-blue-700 hover:underline">{x.label}</Link> : x.label}
                          {x.note ? <span className="ml-1.5 text-neutral-400">{x.note}</span> : null}
                        </td>
                        <td className={TD + " border-l border-neutral-200"} colSpan={3} />
                        <td className={TD + " border-l border-neutral-200"}>{m(x.amount)}</td>
                        <td className={TD} />
                      </tr>
                    )) : null}
                  </Fragment>
                );
              }) : null}
            </Fragment>
          );
        }) : null}
      </Fragment>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {tiles}

      <section aria-labelledby="pay-years" className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 id="pay-years" className="text-base font-semibold">Оплаты по годам</h2>
          <InfoHint label="Как читать таблицу оплат" wide>
            <p><b>Год → вид → оплата → распределение.</b> Год оплаты сырья — год закупки партии, год оплаты работы — год платежа. Нажмите ›, чтобы раскрыть вглубь: сырьё и производство, платежи, а в платеже — на какие закупки партии или ТЗ он разнесён.</p>
            <p className="mt-1"><b>Оплачено</b> = мех + подкладка + работа. <b>Задолженность</b> — сколько осталось оплатить (по сырью — долг поставщику, по работе — долг заказчика); у отдельного платежа её нет. «Итого» совпадает с плитками выше и с Главной.</p>
            <p className="mt-1">Мех включает шкуры подрядчика, оплаченные в составе счетов за пошив. Оплата партии делится между её закупками пропорционально их сумме.</p>
          </InfoHint>
        </div>
        <div className={SCROLL_BOX}>
          <table className="w-full min-w-[820px] table-fixed text-sm">
            <colgroup><col className="w-6" /><col className="w-[190px]" /><col /><col /><col /><col /><col /></colgroup>
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                <th colSpan={2} />
                <th colSpan={3} className="border-b border-l border-neutral-200 px-1.5 pb-1 text-right">Состав оплаты</th>
                <th colSpan={2} className="border-b border-l border-neutral-200 px-1.5 pb-1 text-right">Оплата и долг</th>
              </tr>
              <tr className="border-b border-neutral-200">
                <th className={ARROW_TH} aria-label="Раскрыть" />
                <th className={TH_LEFT}>Год / оплата</th>
                <th className={TH + " border-l border-neutral-200"}>Мех, ₽</th>
                <th className={TH}>Подкладка, ₽</th>
                <th className={TH}>Работа, ₽</th>
                <th className={TH + " border-l border-neutral-200"}>Оплачено, ₽</th>
                <th className={TH}>Задолженность, ₽</th>
              </tr>
            </thead>
            <tbody>
              {years.map(yearBlock)}
              {years.length === 0 ? <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-neutral-500">Оплат за выбранный период нет.</td></tr> : null}
              {years.length > 0 ? (
                <tr className="row-total">
                  <td className={ARROW_TD} />
                  <td className="px-2 py-1.5 text-left"><TotalLabel /></td>
                  {figures({ fur: sum(rows, "fur"), lining: sum(rows, "lining"), work: sum(rows, "work"), paid: sum(rows, "amount"), debt: left.raw + left.prod })}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
