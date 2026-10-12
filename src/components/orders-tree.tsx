"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import type { DrillLine, DrillOrder } from "@/lib/dashboard-drill";
import { articlesWord, orderKey, tzCountText, tzLabel, uniqueOrderCount } from "@/lib/tz-key";
import { isRepair, sumOrders, sumTotal, type Sum, type VatSel } from "@/lib/orders-sum";
import { ARROW_TD, ARROW_TH, Chevron, Dash, INDENT, SCROLL_BOX, TD, TH, TH_LEFT, rowTone } from "@/components/tree-table";
import { TotalLabel } from "@/components/total-label";
import { pathBlock } from "@/lib/block-hover";

export type TreeDim = "year" | "batch" | "article" | "category" | "group" | "fur" | "order";
export type TreeMode = { id: string; label: string; dims: TreeDim[] };

const naturalSort = new Intl.Collator("ru", { numeric: true });

function keyLabel(dim: TreeDim, o: DrillOrder): [string, string] {
  switch (dim) {
    case "year": return [o.y == null ? "none" : String(o.y), o.y == null ? "Без года" : String(o.y)];
    case "batch": return [o.bk, o.bl];
    case "article": return [o.mid, o.ml];
    case "category": return [o.cat, o.cat];
    case "group": return [o.grp, o.grp];
    case "fur": return [o.fur || "none", o.fur || "Мех не указан"];
    // Узел ТЗ — по номеру ТЗ из документа: артикулы одного ТЗ лежат внутри одного узла.
    case "order": return [orderKey(o), `ТЗ ${tzLabel(o)}`];
  }
}

const money = (v: number) => (Math.abs(v) < 0.5 ? <Dash /> : formatMoney(Math.round(v)));

/**
 * Дерево ТЗ в формате Главной: группа (партия / год / артикул / категория) → ТЗ → состав (строки списания по лотам, расходы, работа).
 * Данные — те же ТЗ, что в окне «Стоимость производства» Главной, поэтому итоги совпадают с плитками и между разделами.
 * Режимы НДС и 4% — общие переключатели шапки (суммы с НДС / без НДС; 4% учтён в данных).
 */
export function OrdersTree({
  orders, modes, c4, title, hint, id = "orders-tree", defaultOpenDepth = 0, countRepairQty = false, payBy, empty = "ТЗ нет.",
}: {
  orders: DrillOrder[];
  modes: TreeMode[];
  c4: "on" | "off";
  title: string;
  hint?: ReactNode;
  id?: string;
  /** Сколько верхних уровней раскрыто сразу. */
  defaultOpenDepth?: number;
  /** Страница ремонта: штуки ремонта считаются в «Изд., шт.». */
  countRepairQty?: boolean;
  /** Оплачено заказчиком: ключи `batch:<номер>` и `order:<id>` (₽, с НДС). */
  payBy?: Record<string, number>;
  empty?: string;
}) {
  const { mode: vat } = useVatDisplay();
  const [modeId, setModeId] = useState(modes[0].id);
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const mode = modes.find((m) => m.id === modeId) ?? modes[0];
  const dims = mode.dims;
  const v: VatSel = vat;

  const qtyOf = (s: Sum) => (countRepairQty ? s.qty + s.repairQty : s.qty);
  const isOpen = (path: string, depth: number) => (depth < defaultOpenDepth) !== toggled.has(path);
  const flip = (path: string) => setToggled((s) => { const n = new Set(s); if (n.has(path)) n.delete(path); else n.add(path); return n; });

  const grand = useMemo(() => sumOrders(orders, v), [orders, v]);
  const nonRepair = useMemo(() => sumOrders(orders.filter((o) => !isRepair(o)), v), [orders, v]);
  const repair = useMemo(() => sumOrders(orders.filter(isRepair), v), [orders, v]);
  const showPay = !!payBy;
  // «Прочее» (разница снимка ТЗ и строк) — отдельный столбец только если она есть; расходы ТЗ входят в «Работа».
  const showRes = Math.abs(grand.other - grand.exp) > 0.5;
  const cols = 10 + (c4 === "on" ? 1 : 0) + (showRes ? 1 : 0) + (showPay ? 2 : 0);

  const figs = (s: Sum, opts: { qty?: boolean; pay?: { paid: number | undefined; work: number } } = {}) => {
    const q = qtyOf(s);
    const total = sumTotal(s);
    const paid = opts.pay?.paid;
    const left = paid == null ? null : opts.pay!.work - paid;
    return (
      <>
        <td className={TD}>{opts.qty === false || q === 0 ? <Dash /> : formatQty(q)}</td>
        <td className={TD}>{opts.qty === false || q === 0 ? <Dash /> : money(total / q)}</td>
        <td className={TD + " border-l border-neutral-200"}>{s.furQ > 0 ? formatQty(s.furQ) : <Dash />}</td>
        <td className={TD}>{s.liningQ > 0 ? formatQty(s.liningQ) : <Dash />}</td>
        <td className={TD + " border-l border-neutral-200"}>{money(total)}</td>
        <td className={TD}>{money(s.fur)}</td>
        <td className={TD}>{money(s.lining)}</td>
        <td className={TD}>{money(s.work + s.exp)}</td>
        {c4 === "on" ? <td className={TD}>{money(s.c4)}</td> : null}
        {showRes ? <td className={TD}>{money(s.other - s.exp)}</td> : null}
        {showPay ? (
          <>
            <td className={TD + " border-l border-neutral-200"}>{paid == null ? <Dash /> : money(paid)}</td>
            <td className={TD + (left != null && left > 0.5 ? " text-amber-700" : left != null && left < -0.5 ? " text-emerald-700" : "")}>{left == null ? <Dash /> : Math.abs(left) < 0.5 ? <Dash /> : left < 0 ? <>сверх {formatMoney(Math.round(-left))}</> : formatMoney(Math.round(left))}</td>
          </>
        ) : null}
      </>
    );
  };

  const arrow = (open: boolean, label: string, path: string) => (
    <button type="button" onClick={() => flip(path)} aria-expanded={open} aria-label={`Раскрыть: ${label}`}><Chevron open={open} /></button>
  );

  const lineRows = (o: DrillOrder, depth: number, anc: string[]) => {
    const tone = rowTone(3);
    const ind = INDENT[Math.min(depth, 3)];
    // work — сумма «Работы» строки (работа и доп. расходы ТЗ): стоит в столбце «Работа», а в «Себестоимость» у такой строки «—».
    // Себестоимость узла (ТЗ, партии) от этого не меняется: она считается по Sum (мех + подкладка + 4% + расходы + работа).
    const cell = (label: ReactNode, sub: ReactNode, s: Partial<Sum> & { res?: number }, key: string, qs?: { fur?: number; lining?: number }, asWork = false) => (
      <tr key={key} className={tone} data-block={anc.join(" ") || undefined}>
        <td className={ARROW_TD} />
        <td className={`py-1.5 pr-2 text-left ${ind}`}>{label}{sub ? <div className="mt-0.5 text-[11px] leading-4 text-neutral-400">{sub}</div> : null}</td>
        <td className={TD} /><td className={TD} />
        <td className={TD + " border-l border-neutral-200"}>{qs?.fur ? formatQty(qs.fur) : <Dash />}</td>
        <td className={TD}>{qs?.lining ? formatQty(qs.lining) : <Dash />}</td>
        <td className={TD + " border-l border-neutral-200"}>{asWork ? <Dash /> : money((s.fur ?? 0) + (s.lining ?? 0) + (s.c4 ?? 0) + (s.res ?? 0))}</td>
        <td className={TD}>{asWork ? <Dash /> : money(s.fur ?? 0)}</td>
        <td className={TD}>{asWork ? <Dash /> : money(s.lining ?? 0)}</td>
        <td className={TD}>{money(s.work ?? 0)}</td>
        {c4 === "on" ? <td className={TD}>{asWork ? <Dash /> : money(s.c4 ?? 0)}</td> : null}
        {showRes ? <td className={TD}>{money(s.res ?? 0)}</td> : null}
        {showPay ? <><td className={TD + " border-l border-neutral-200"} /><td className={TD} /></> : null}
      </tr>
    );
    const out: ReactNode[] = [];
    const lines = [...o.lines].sort((a, b) => (a.k === b.k ? 0 : a.k === "f" ? -1 : 1));
    lines.forEach((l: DrillLine, i) => {
      const c = v === "incl" ? l.ci : l.ce;
      const base = (v === "incl" ? l.i : l.e) - c;
      const vatPart = (l.i - l.ci) - (l.e - l.ce);
      const unit = l.k === "l" ? "м" : "шк.";
      out.push(cell(
        <span>{l.k === "l" ? "Подкладка" : "Мех"} · {l.n}</span>,
        <>
          {l.ln ? <Link href={`/analytics/raw/lot/${l.lot}`} className="text-blue-700 hover:underline">лот {l.ln}</Link> : <Link href={`/analytics/raw/lot/${l.lot}`} className="text-blue-700 hover:underline">лот без номера</Link>}
          {l.pid ? <> · <Link href={`/purchases/${l.pid}`} className="text-blue-700 hover:underline">закупка {l.pn}</Link></> : null}
          {l.au ? <> · {l.au}</> : null}
          {" · "}{formatQty(l.q)} {unit}{l.q > 0 ? <> по {formatMoney(Math.round(base / l.q))}</> : null}
          {Math.abs(vatPart) > 0.5 ? <> · НДС {formatMoney(Math.round(vatPart))}</> : null}
          {c > 0.5 ? <> · 4% {formatMoney(Math.round(c))}</> : null}
        </>,
        l.k === "l" ? { lining: base, c4: c } : { fur: base, c4: c },
        `l${i}`,
        l.k === "l" ? { lining: l.q } : { fur: l.q },
      ));
    });
    const h = v === "incl" ? o.hI : o.hE;
    if (Math.abs(h) > 0.5) out.push(cell("Шкуры подрядчика", "оплачены в составе счетов за пошив, в ТЗ не списаны", { fur: h }, "h"));
    // Доп. расходы ТЗ — отдельными строками по статьям, их суммы стоят в столбце «Работа» (вместе с работой).
    if (Math.abs(o.exp) > 0.5) {
      const xs = (o.xs ?? []).filter((x) => Math.abs(x.a) > 0.005);
      const rest = o.exp - xs.reduce((a, x) => a + x.a, 0);
      xs.forEach((x, i) => out.push(cell(`Доп. расходы · ${x.n}`, "без НДС и без 4%", { work: x.a }, `e${i}`, undefined, true)));
      if (Math.abs(rest) > 0.5 || xs.length === 0) out.push(cell("Доп. расходы", "без НДС и без 4%", { work: rest }, "e", undefined, true));
    }
    const res = v === "incl" ? o.resI : o.resE;
    if (Math.abs(res) > 0.5) out.push(cell("Прочее", "разница между итогом ТЗ и суммой строк", { res }, "r"));
    if (Math.abs(o.work) > 0.5) out.push(cell("Работа заказчику", o.qty > 0 ? <>{formatMoney(Math.round(o.work / o.qty))} за изделие × {formatQty(o.qty)} шт.</> : "цена работы × количество", { work: o.work }, "w", undefined, true));
    if (out.length === 0) out.push(<tr key="none" className={tone}><td className={ARROW_TD} /><td colSpan={cols - 1} className={`py-1.5 pr-2 text-left text-neutral-400 ${ind}`}>Списаний и расходов нет</td></tr>);
    return out;
  };

  // Позиции многопозиционного ТЗ: артикул × количество, каждая раскрывается в состав (как отдельное ТЗ).
  const positionRows = (list: DrillOrder[], depth: number, path: string, anc: string[]): ReactNode =>
    [...list].sort((a, b) => naturalSort.compare(a.number, b.number)).map((o) => {
      const p = `${path}/${o.id}`;
      const open = isOpen(p, depth);
      const s = sumOrders([o], v);
      const tok = pathBlock(p);
      return (
        <Fragment key={p}>
          <tr className={rowTone(2, open)} data-hover-block={tok} data-block={anc.join(" ") || undefined}>
            <td className={ARROW_TD}>{arrow(open, `${o.ml} (${o.number})`, p)}</td>
            <td className={`py-1.5 pr-2 text-left ${INDENT[Math.min(depth, 3)]}`}>
              <Link href={`/production/${o.id}`} className="text-blue-700 hover:underline">{o.ml}</Link>
              <span className="ml-2 font-normal text-neutral-500">{formatQty(o.qty)} шт. · {o.number}</span>
            </td>
            {figs(s, { pay: payBy ? { paid: payBy[`order:${o.id}`], work: s.work } : undefined })}
          </tr>
          {open ? lineRows(o, depth + 1, [...anc, tok]) : null}
        </Fragment>
      );
    });

  const sortGroups = (dim: TreeDim, groups: [string, string, DrillOrder[]][]) => {
    if (dim === "year" || dim === "batch") return groups.sort((a, b) => (a[0] === "none" ? 1 : b[0] === "none" ? -1 : Number(a[0]) - Number(b[0])));
    if (dim === "order") return groups.sort((a, b) => naturalSort.compare(a[1], b[1]));
    return groups.sort((a, b) => sumTotal(sumOrders(b[2], v)) - sumTotal(sumOrders(a[2], v)));
  };

  const hrefOf = (dim: TreeDim, key: string, list: DrillOrder[]): string | null =>
    dim === "batch" && key !== "none" ? `/production/batches/${key}` : dim === "article" ? `/models/${key}` : dim === "order" && list.length === 1 ? `/production/${list[0].id}` : null;

  // Оплачено по ТЗ: сумма по позициям (записям) этого ТЗ.
  const sumPaid = (list: DrillOrder[]): number | undefined => {
    if (!payBy) return undefined;
    let any = false, t = 0;
    for (const x of list) { const v = payBy[`order:${x.id}`]; if (v != null) { any = true; t += v; } }
    return any ? t : undefined;
  };

  const level = (os: DrillOrder[], depth: number, path: string, anc: string[] = []): ReactNode => {
    const dim = dims[depth];
    const map = new Map<string, [string, string, DrillOrder[]]>();
    for (const o of os) {
      const [k, l] = keyLabel(dim, o);
      const g = map.get(k) ?? [k, l, []];
      g[2].push(o);
      map.set(k, g);
    }
    return sortGroups(dim, Array.from(map.values())).map(([key, label, list]) => {
      const p = `${path}/${key}`;
      const open = isOpen(p, depth);
      const s = sumOrders(list, v);
      const tone = Math.min(depth, 2) as 0 | 1 | 2;
      const href = hrefOf(dim, key, list);
      const isOrder = dim === "order";
      const o = list[0];
      const tok = pathBlock(p);
      const paid = payBy ? (dim === "batch" ? payBy[`batch:${key}`] : isOrder ? sumPaid(list) : undefined) : undefined;
      return (
        <Fragment key={p}>
          <tr className={rowTone(tone, open) + (depth === 0 ? " font-semibold" : "")} data-hover-block={tok} data-block={anc.join(" ") || undefined}>
            <td className={ARROW_TD}>{arrow(open, label, p)}</td>
            <td className={`py-1.5 pr-2 text-left ${INDENT[Math.min(depth, 3)]}`}>
              {href ? <Link href={href} className="text-blue-700 hover:underline">{label}</Link> : label}
              {isOrder ? (
                <>
                  <span className="ml-2 font-normal text-neutral-500">{list.length > 1 ? `${list.length} ${articlesWord(list.length)}` : o.ml}</span>
                  {isRepair(o) && !countRepairQty ? <span className="ml-2 font-normal text-neutral-400">ремонт</span> : null}
                  {dims.includes("batch") ? null : <span className="ml-2 font-normal text-neutral-400">{o.bl}</span>}
                </>
              ) : (
                <span className="ml-1.5 text-xs font-normal text-neutral-500">{tzCountText(uniqueOrderCount(list), list.length)}</span>
              )}
            </td>
            {figs(s, { pay: payBy ? { paid, work: s.work } : undefined })}
          </tr>
          {open ? (depth + 1 < dims.length ? level(list, depth + 1, p, [...anc, tok]) : isOrder && list.length > 1 ? positionRows(list, depth + 1, p, [...anc, tok]) : lineRows(o, depth + 1, [...anc, tok])) : null}
        </Fragment>
      );
    });
  };

  return (
    <section aria-labelledby={id} className="space-y-2" id={id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id={id} className="text-base font-semibold">{title}</h2>
          <InfoHint label={`Как читать: ${title}`} wide>
            {hint}
            <p className="mt-1">Нажмите ›, чтобы раскрыть вглубь: группа → ТЗ → состав (мех и подкладка по лотам со ссылками на лот и закупку, шкуры подрядчика, работа и доп. расходы). Номер ТЗ ведёт в карточку ТЗ.</p>
            <p className="mt-1"><b>Себестоимость</b> = мех + подкладка + 4%{c4 === "on" ? "" : " (сейчас «Без 4%»)"} + работа. В столбце «Работа» — работа и доп. расходы ТЗ («Доп. расходы · статья»); у таких строк состава «Себестоимость» — «—», а в итог узла они входят как раньше. «Шкур, шт.» и «Подкладка, м» — сколько использовано по списаниям. «Изд., шт.» — без ремонта. Режим «С НДС / Без НДС» — общий переключатель в шапке.</p>
          </InfoHint>
        </div>
        {modes.length > 1 ? (
          <div role="tablist" aria-label="Разрез таблицы" className="inline-flex overflow-hidden rounded-lg border border-neutral-300 text-xs">
            {modes.map((m) => (
              <button key={m.id} type="button" role="tab" aria-selected={m.id === mode.id} onClick={() => { setModeId(m.id); setToggled(new Set()); }}
                className={"px-3 py-1.5 " + (m.id === mode.id ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 hover:bg-neutral-50")}>{m.label}</button>
            ))}
          </div>
        ) : null}
      </div>
      <div className={SCROLL_BOX}>
        <table className="w-full min-w-[1120px] text-sm">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              <th />
              <th />
              <th colSpan={2} className="border-b border-neutral-200 px-2 pb-1 text-left">Выпуск</th>
              <th colSpan={2} className="border-b border-l border-neutral-200 px-2 pb-1 text-left">Использовано</th>
              <th colSpan={5 + (c4 === "on" ? 1 : 0) + (showRes ? 1 : 0)} className="border-b border-l border-neutral-200 px-2 pb-1 text-left">Себестоимость и состав</th>
              {showPay ? <th colSpan={2} className="border-b border-l border-neutral-200 px-2 pb-1 text-left">Оплата</th> : null}
            </tr>
            <tr className="border-b border-neutral-200">
              <th className={ARROW_TH} aria-label="Раскрыть" />
              <th className={TH_LEFT}>{mode.label}</th>
              <th className={TH}>Изд., шт.</th>
              <th className={TH}>На изделие</th>
              <th className={TH + " border-l border-neutral-200"}>Шкур, шт.</th>
              <th className={TH}>Подкладка, м</th>
              <th className={TH + " border-l border-neutral-200"}>Себестоимость</th>
              <th className={TH}>Мех</th>
              <th className={TH}>Подкладка</th>
              <th className={TH}>Работа</th>
              {c4 === "on" ? <th className={TH}>4%</th> : null}
              {showRes ? <th className={TH}>Прочее</th> : null}
              {showPay ? <><th className={TH + " border-l border-neutral-200"}>Оплачено</th><th className={TH}>К оплате по работе</th></> : null}
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? <tr><td colSpan={cols} className="px-3 py-6 text-center text-sm text-neutral-500">{empty}</td></tr> : level(orders, 0, "")}
            {orders.length > 0 ? (
              repair.repairOrders > 0 && nonRepair.orders > 0 ? (
                <>
                  <tr className="row-total">
                    <td className={ARROW_TD} /><td className="px-2 py-1.5 text-left"><TotalLabel note="без ремонта" /></td>{figs(nonRepair, { pay: payBy ? { paid: undefined, work: 0 } : undefined })}
                  </tr>
                  <tr className="border-b border-neutral-100">
                    <td className={ARROW_TD} /><td className="px-2 py-1.5 text-left"><Link href="/repair" className="text-blue-700 hover:underline">Ремонт ›</Link><span className="ml-1.5 text-xs text-neutral-500">{repair.repairOrders} ТЗ, не входит в «Произведено»</span></td>{figs(repair, { qty: false })}
                  </tr>
                  <tr className="row-total">
                    <td className={ARROW_TD} /><td className="px-2 py-1.5 text-left"><TotalLabel note="с ремонтом" /></td>{figs(grand, { qty: false })}
                  </tr>
                </>
              ) : (
                <tr className="row-total">
                  <td className={ARROW_TD} /><td className="px-2 py-1.5 text-left"><TotalLabel /></td>{figs(grand, { pay: payBy ? { paid: undefined, work: 0 } : undefined })}
                </tr>
              )
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

