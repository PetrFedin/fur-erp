"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { SEG_GROUP, segCls } from "@/components/segmented";
import { saveBase64Xlsx } from "@/lib/download-xlsx";
import { alignColumn } from "@/lib/money-round";
import { exportCashflowReportXlsx } from "../actions";
import { type CashflowData, type CashflowPeriod, type PrepaidItem } from "@/lib/cashflow";
import { full, dash } from "./shared";

/** Классический Cash Flow: статьи в строках, месяцы в столбцах, после декабря — итог года, в конце «Всего». Платежи со знаком минус. */
export function ClassicTable({ period, vatPay, vatRev, prepaid, prepaidList, hasVat, title, months, d, ser, hasSales, filtered, detail, setDetail, hot, setHot, active, setActive, yearHot, setYearHot }: { period: CashflowPeriod; vatPay: number[]; vatRev: number[]; prepaid: number[]; prepaidList: PrepaidItem[]; hasVat: boolean; title: string; hot: string | null; setHot: (k: string | null) => void; active: number | null; setActive: (i: number | null) => void; yearHot: string | null; setYearHot: (y: string | null) => void; months: string[]; d: CashflowData; ser: { spend: number[]; revenue: number[]; net: number[]; cumNet: number[] }; hasSales: boolean; filtered: boolean; detail: boolean; setDetail: (v: boolean) => void }) {
  const art = (k: string) => d.articles.find((a) => a.key === k)?.byMonth ?? months.map(() => 0);
  const add = (...xs: number[][]) => months.map((_, i) => xs.reduce((s, x) => s + (x[i] ?? 0), 0));
  const neg = (x: number[]) => x.map((v) => -v);
  const auction = neg(art("furAuction")), purchase = neg(add(art("furPurchase"), art("hides"))), lining = neg(art("lining"));
  const work = neg(art("work")), services = neg(art("services"));
  const raw = add(auction, purchase, lining), workAll = add(work, services);
  const pay = neg(ser.spend);
  const first = months.findIndex((_, i) => Math.abs(ser.spend[i]) > 0.5 || Math.abs(ser.revenue[i]) > 0.5);
  const last = months.length - 1 - [...months].reverse().findIndex((_, i) => Math.abs(ser.spend[months.length - 1 - i]) > 0.5 || Math.abs(ser.revenue[months.length - 1 - i]) > 0.5);
  const shown = first < 0 ? [] : months.map((_, i) => i).filter((i) => i >= first && i <= last);
  const years = Array.from(new Set(shown.map((i) => months[i].slice(0, 4))));
  type Col = { key: string; label: string; idx: number[]; total: boolean };
  const cols: Col[] = [];
  for (const y of years) {
    const ys = shown.filter((i) => months[i].startsWith(y));
    for (const i of ys) cols.push({ key: months[i], label: months[i].slice(5, 7) + "." + months[i].slice(2, 4), idx: [i], total: false });
    cols.push({ key: "y" + y, label: "Итого " + y, idx: ys, total: true });
  }
  cols.push({ key: "all", label: "Всего", idx: shown, total: true });
  const [gran, setGran] = useState<"months" | "years">("months");
  const colsShown = gran === "years" ? cols.filter((c) => c.total) : cols;
  const sum = (x: number[], c: Col) => c.idx.reduce((s, i) => s + (x[i] ?? 0), 0);
  // Показанные суммы статей складываются в показанный итог «ПЛАТЕЖИ» до рубля (наибольшие остатки, как в плитках), поступления и чистый поток — от показанных частей.
  const aligned = useMemo(() => {
    const m = new Map<string, number>();
    const leaves: [string, number[]][] = [["a", auction], ["p", purchase], ["l", lining], ["w", work], ["s", services]];
    for (const c of cols) {
      const al = alignColumn(leaves.map(([, x]) => -sum(x, c)), -sum(pay, c));
      leaves.forEach(([k], i) => m.set(k + "|" + c.key, -al.values[i]));
      m.set("raw|" + c.key, -(al.values[0] + al.values[1] + al.values[2]));
      m.set("workAll|" + c.key, -(al.values[3] + al.values[4]));
      m.set("pay|" + c.key, -al.total);
      const rev = Math.round(sum(ser.revenue, c));
      m.set("rev|" + c.key, rev);
      m.set("net|" + c.key, rev - al.total);
    }
    return m;
  }, [cols, auction, purchase, lining, work, services, pay, ser.revenue]);
  type R = { label: string; x: number[] | null; lvl: 0 | 1 | 2; cum?: boolean; art?: string; id?: string };
  const rows: R[] = [
    ...(hasSales ? [{ label: "ПОСТУПЛЕНИЯ · выручка от продаж", x: ser.revenue, lvl: 0 as const, id: "rev" }] : []),
    { label: "ПЛАТЕЖИ", x: pay, lvl: 0, id: "pay" },
    { label: "Сырьё и материалы", x: raw, lvl: 1, id: "raw" },
    { art: "furAuction", label: "Мех: аукционы", x: auction, lvl: 2, id: "a" },
    { art: "furPurchase", label: "Мех: закупка у поставщика", x: purchase, lvl: 2, id: "p" },
    { art: "lining", label: "Подкладка", x: lining, lvl: 2, id: "l" },
    { label: "Работа и услуги", x: workAll, lvl: 1, id: "workAll" },
    { art: "work", label: "Работа подрядчику", x: work, lvl: 2, id: "w" },
    { art: "services", label: "Услуги по УПД", x: services, lvl: 2, id: "s" },
    ...(hasSales && !filtered ? [{ label: "ЧИСТЫЙ ДЕНЕЖНЫЙ ПОТОК", x: ser.net, lvl: 0 as const, id: "net" }, { label: "Накопленный чистый поток", x: ser.cumNet, lvl: 1 as const, cum: true }] : []),
  ];
  const aimCol = (c: Col) => { if (c.total) { setActive(null); setYearHot(c.key.startsWith("y") ? c.key.slice(1) : null); } else { setYearHot(null); setActive(c.idx[0]); } };
  const stick = "sticky left-0 z-[1] text-left";
  const [refOpen, setRefOpen] = useState(false);
  const [prepOpen, setPrepOpen] = useState(false);
  const [repBusy, setRepBusy] = useState(false);
  const downloadReport = async () => {
    setRepBusy(true);
    try { const res = await exportCashflowReportXlsx(period); if (res.ok) saveBase64Xlsx(res.name, res.base64); } finally { setRepBusy(false); }
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <h2 className="text-sm font-semibold">{title}</h2>
        
        <button type="button" aria-expanded={detail} onClick={() => setDetail(!detail)} className="inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-3 text-sm md:min-h-9">{detail ? "Скрыть таблицу" : "Показать таблицу"}</button>
        {detail ? (
          <div role="group" aria-label="Столбцы" className={SEG_GROUP}>
            {([["months", "По месяцам"], ["years", "По годам"]] as const).map(([k, t]) => <button key={k} type="button" aria-pressed={gran === k} onClick={() => setGran(k)} className={segCls(gran === k)}>{t}</button>)}
          </div>
        ) : null}
        <button type="button" onClick={downloadReport} disabled={repBusy} title="Excel на три листа: «Данные» (откуда собрано), «Сводная» и «Отчёт» (месяцы в столбцах, НДС отдельно снизу)" className="ml-auto inline-flex min-h-11 items-center rounded-lg border border-neutral-300 bg-white px-3 text-sm font-medium disabled:opacity-60 md:min-h-9">{repBusy ? "Готовлю Excel…" : "Скачать Excel"}</button>
      </div>
      {detail && (
        <div className="max-h-[75vh] overflow-auto rounded-lg border border-neutral-300 bg-white" tabIndex={0} role="region" aria-label="Cashflow: статьи в строках, месяцы и итоги года в столбцах">
          <table className="table-keep border-collapse text-sm" onMouseLeave={() => { setHot(null); setActive(null); setYearHot(null); }}>
            <thead>
              <tr className="border-b border-neutral-300">
                <th scope="col" className={"min-w-[14rem] bg-white px-2 py-2 text-xs font-semibold " + stick + " top-0 z-[2]"}>Статья, ₽</th>
                {colsShown.map((c) => <th key={c.key} scope="col" onMouseEnter={() => aimCol(c)} className={"px-2 py-2 text-right text-xs font-semibold whitespace-nowrap " + (c.total ? "border-l border-neutral-300 bg-neutral-100" : "") + (!c.total && active === c.idx[0] ? " bg-[var(--ui-soft)]" : "")}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} onMouseEnter={() => setHot(r.art ?? null)} className={(r.art && hot === r.art ? "bg-[var(--ui-soft)] " : "") + (r.lvl === 0 ? "border-y border-neutral-300 bg-neutral-100 font-bold" : r.lvl === 1 ? "border-b border-neutral-200 font-semibold" : "border-b border-neutral-100")}>
                  <th scope="row" className={"px-2 py-1.5 " + stick + " " + (r.lvl === 0 ? "bg-neutral-100" : r.art && hot === r.art ? "bg-[var(--ui-soft)]" : "bg-white") + (r.lvl === 2 ? " pl-6 font-normal" : r.lvl === 1 ? " pl-4" : "")}>{r.label}</th>
                  {colsShown.map((c) => {
                    const v = r.cum ? (c.idx.length ? (r.x as number[])[c.idx[c.idx.length - 1]] : 0) : (r.id ? aligned.get(r.id + "|" + c.key) : undefined) ?? sum(r.x as number[], c);
                    // Минус красным, плюс зелёным (те же цвета, что у плиток «Чистый денежный поток»).
                    const tone = v < -0.5 ? " text-[#b4310b]" : v > 0.5 ? " text-[#17613c]" : "";
                    return <td key={c.key} onMouseEnter={() => aimCol(c)} className={"min-w-[6.5rem] px-2 py-1.5 text-right tabular-nums whitespace-nowrap" + tone + " " + (c.total ? "border-l border-neutral-300 font-semibold" : "")}>{dash(v)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detail && (
        <div className="rounded-lg border border-neutral-300 bg-white">
          <button type="button" aria-expanded={refOpen} onClick={() => setRefOpen((v) => !v)} className="flex min-h-11 w-full items-center gap-1.5 px-3 text-left text-sm font-semibold"><span aria-hidden>{refOpen ? "▾" : "▸"}</span>Справочно: НДС и предоплата</button>
          {refOpen && <div className="overflow-auto border-t border-neutral-200" tabIndex={0} role="region" aria-label="Справочно по месяцам">
            <table className="table-keep border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-300">
                  <th scope="col" className={"min-w-[14rem] bg-white px-2 py-2 text-xs font-semibold " + stick}>Статья, ₽</th>
                  {colsShown.map((c) => <th key={c.key} scope="col" className={"px-2 py-2 text-right text-xs font-semibold whitespace-nowrap " + (c.total ? "border-l border-neutral-300 bg-neutral-100" : "")}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {([["НДС в составе платежей", vatPay], ...(hasVat ? [["НДС в составе выручки", vatRev], ["Разница НДС", vatRev.map((v, i) => v - (vatPay[i] ?? 0))]] : []), ["Предоплата за непринятые заказы", prepaid]] as [string, number[]][]).map(([lab, arr]) => {
                  const isPre = lab.startsWith("Предоплата");
                  const amtIn = (items: PrepaidItem[], c: Col) => items.filter((it) => c.idx.some((i) => months[i] === it.iso.slice(0, 7))).reduce((t, it) => t + it.amount, 0);
                  const groups = isPre && prepOpen ? [...new Set(prepaidList.map((it) => it.label))].map((name) => ({ name, items: prepaidList.filter((it) => it.label === name) })) : [];
                  const cellCls = (c: Col, bold?: boolean) => "min-w-[6.5rem] px-2 py-1.5 text-right tabular-nums whitespace-nowrap " + (c.total ? "border-l border-neutral-300 font-semibold" : bold ? "font-semibold" : "");
                  return (
                    <Fragment key={lab}>
                      <tr className="border-b border-neutral-100">
                        <th scope="row" title={isPre ? "Деньги ушли, товара пока нет: запасы, а не расход" : undefined} className={"bg-white px-2 py-1.5 font-normal " + stick}>
                          {isPre && prepaidList.length > 0 ? <button type="button" aria-expanded={prepOpen} onClick={() => setPrepOpen((v) => !v)} className="inline-flex min-h-11 items-center gap-1.5 text-left font-normal underline decoration-dotted underline-offset-2"><span aria-hidden>{prepOpen ? "▾" : "▸"}</span>{lab}</button> : lab}
                        </th>
                        {colsShown.map((c) => <td key={c.key} className={cellCls(c)}>{dash(sum(arr, c))}</td>)}
                      </tr>
                      {groups.map((g) => (
                        <Fragment key={g.name}>
                          <tr className="border-b border-neutral-100 bg-neutral-50">
                            <th scope="row" className={"bg-neutral-50 px-2 py-1.5 pl-6 text-left font-semibold " + stick}>{g.name}</th>
                            {colsShown.map((c) => <td key={c.key} className={cellCls(c, true)}>{dash(amtIn(g.items, c))}</td>)}
                          </tr>
                          {g.items.map((it) => (
                            <tr key={it.id} className="border-b border-neutral-100">
                              <th scope="row" className={"bg-white px-2 py-1.5 pl-10 text-left text-xs font-normal text-neutral-700 " + stick}>
                                <Link href={it.href} className="underline decoration-neutral-400 underline-offset-2">{it.iso.split("-").reverse().join(".")} · {it.what}{it.doc ? ` · ${it.doc}` : ""}</Link>
                              </th>
                              {colsShown.map((c) => <td key={c.key} className={cellCls(c) + " text-xs"}>{dash(amtIn([it], c))}</td>)}
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>}
        </div>
      )}
    </>
  );
}
