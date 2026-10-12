"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import type { DrillLine, DrillOrder } from "@/lib/dashboard-drill";
import { isRepair, sumOrders, sumTotal, type Sum, type VatSel } from "@/lib/orders-sum";
import { ARROW_TD, ARROW_TH, Chevron, Dash, INDENT, SCROLL_BOX, TD, TH, TH_LEFT, rowTone } from "@/components/tree-table";
import { TotalLabel } from "@/components/total-label";

export type TreeDim = "year" | "batch" | "article" | "category" | "group" | "fur" | "order";
export type TreeMode = { id: string; label: string; dims: TreeDim[] };

const STATUS_TEXT: Record<string, string> = { PLANNED: "запланирован", IN_PROGRESS: "в работе", COMPLETED: "" };
const naturalSort = new Intl.Collator("ru", { numeric: true });

function keyLabel(dim: TreeDim, o: DrillOrder): [string, string] {
  switch (dim) {
    case "year": return [o.y == null ? "none" : String(o.y), o.y == null ? "Без года" : String(o.y)];
    case "batch": return [o.bk, o.bl];
    case "article": return [o.mid, o.ml];
    case "category": return [o.cat, o.cat];
    case "group": return [o.grp, o.grp];
    case "fur": return [o.fur || "none", o.fur || "Мех не указан"];
    case "order": return [o.id, `ТЗ ${o.wo ?? o.number}`];
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
  const cols = 9 + (c4 === "on" ? 1 : 0) + (showPay ? 2 : 0);

  const figs = (s: Sum, opts: { qty?: boolean; pay?: { paid: number | undefined; work: number } } = {}) => {
    const q = qtyOf(s);
    const total = sumTotal(s);
    const paid = opts.pay?.paid;
    const left = paid == null ? null : opts.pay!.work - paid;
    return (
      <>
        <td className={TD}>{opts.qty === false || q === 0 ? <Dash /> : formatQty(q)}</td>
        <td className={TD}>{opts.qty === false || q === 0 ? <Dash /> : money(total / q)}</td>
        <td className={TD + " border-l border-neutral-100"}>{money(total)}</td>
        <td className={TD}>{money(s.fur)}</td>
        <td className={TD}>{money(s.lining)}</td>
        <td className={TD}>{money(s.work)}</td>
        {c4 === "on" ? <td className={TD}>{money(s.c4)}</td> : null}
        <td className={TD}>{money(s.other)}</td>
        {showPay ? (
          <>
            <td className={TD + " border-l border-neutral-100"}>{paid == null ? <Dash /> : money(paid)}</td>
            <td className={TD + (left != null && left > 0.5 ? " text-amber-700" : left != null && left < -0.5 ? " text-emerald-700" : "")}>{left == null ? <Dash /> : Math.abs(left) < 0.5 ? <Dash /> : left < 0 ? <>сверх {formatMoney(Math.round(-left))}</> : formatMoney(Math.round(left))}</td>
          </>
        ) : null}
      </>
    );
  };

  const arrow = (open: boolean, label: string, path: string) => (
    <button type="button" onClick={() => flip(path)} aria-expanded={open} aria-label={`Раскрыть: ${label}`}><Chevron open={open} /></button>
  );

  const lineRows = (o: DrillOrder, depth: number) => {
    const tone = rowTone(3);
    const ind = INDENT[Math.min(depth, 3)];
    const cell = (label: ReactNode, sub: ReactNode, s: Partial<Sum>, key: string) => (
      <tr key={key} className={tone}>
        <td className={ARROW_TD} />
        <td className={`py-1.5 pr-2 text-left ${ind}`}>{label}{sub ? <div className="mt-0.5 text-[11px] leading-4 text-neutral-400">{sub}</div> : null}</td>
        <td className={TD} /><td className={TD} />
        <td className={TD + " border-l border-neutral-100"}>{money((s.fur ?? 0) + (s.lining ?? 0) + (s.c4 ?? 0) + (s.other ?? 0) + (s.work ?? 0))}</td>
        <td className={TD}>{money(s.fur ?? 0)}</td>
        <td className={TD}>{money(s.lining ?? 0)}</td>
        <td className={TD}>{money(s.work ?? 0)}</td>
        {c4 === "on" ? <td className={TD}>{money(s.c4 ?? 0)}</td> : null}
        <td className={TD}>{money(s.other ?? 0)}</td>
        {showPay ? <><td className={TD + " border-l border-neutral-100"} /><td className={TD} /></> : null}
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
      ));
    });
    const h = v === "incl" ? o.hI : o.hE;
    if (Math.abs(h) > 0.5) out.push(cell("Шкуры подрядчика", "оплачены в составе счетов за пошив, в ТЗ не списаны", { fur: h }, "h"));
    if (Math.abs(o.exp) > 0.5) out.push(cell("Расходы ТЗ", "без НДС и без 4%", { other: o.exp }, "e"));
    const res = v === "incl" ? o.resI : o.resE;
    if (Math.abs(res) > 0.5) out.push(cell("Прочее", "разница между итогом ТЗ и суммой строк", { other: res }, "r"));
    if (Math.abs(o.work) > 0.5) out.push(cell("Работа заказчику", o.qty > 0 ? <>{formatMoney(Math.round(o.work / o.qty))} за изделие × {formatQty(o.qty)} шт.</> : "цена работы × количество", { work: o.work }, "w"));
    if (out.length === 0) out.push(<tr key="none" className={tone}><td className={ARROW_TD} /><td colSpan={cols - 1} className={`py-1.5 pr-2 text-left text-neutral-400 ${ind}`}>Списаний и расходов нет</td></tr>);
    return out;
  };

  const sortGroups = (dim: TreeDim, groups: [string, string, DrillOrder[]][]) => {
    if (dim === "year" || dim === "batch") return groups.sort((a, b) => (a[0] === "none" ? 1 : b[0] === "none" ? -1 : Number(a[0]) - Number(b[0])));
    if (dim === "order") return groups.sort((a, b) => naturalSort.compare(a[1], b[1]));
    return groups.sort((a, b) => sumTotal(sumOrders(b[2], v)) - sumTotal(sumOrders(a[2], v)));
  };

  const hrefOf = (dim: TreeDim, key: string): string | null =>
    dim === "batch" && key !== "none" ? `/production/batches/${key}` : dim === "article" ? `/models/${key}` : dim === "order" ? `/production/${key}` : null;

  const level = (os: DrillOrder[], depth: number, path: string): ReactNode => {
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
      const href = hrefOf(dim, key);
      const isOrder = dim === "order";
      const o = list[0];
      const paid = payBy ? (dim === "batch" ? payBy[`batch:${key}`] : isOrder ? payBy[`order:${key}`] : undefined) : undefined;
      return (
        <Fragment key={p}>
          <tr className={rowTone(tone, open) + (depth === 0 ? " font-semibold" : "")}>
            <td className={ARROW_TD}>{arrow(open, label, p)}</td>
            <td className={`py-1.5 pr-2 text-left ${INDENT[Math.min(depth, 3)]}`}>
              {href ? <Link href={href} className="text-blue-700 hover:underline">{label}</Link> : label}
              {isOrder ? (
                <>
                  <span className="ml-2 font-normal text-neutral-500">{o.ml}</span>
                  {isRepair(o) && !countRepairQty ? <span className="ml-2 font-normal text-neutral-400">ремонт</span> : null}
                  {STATUS_TEXT[o.st] ? <span className="ml-2 font-normal text-amber-700">{STATUS_TEXT[o.st]}</span> : null}
                  {dims.includes("batch") ? null : <span className="ml-2 font-normal text-neutral-400">{o.bl}</span>}
                </>
              ) : (
                <span className="ml-1.5 text-xs font-normal text-neutral-500">{s.orders + s.repairOrders} ТЗ</span>
              )}
            </td>
            {figs(s, { pay: payBy ? { paid, work: s.work } : undefined })}
          </tr>
          {open ? (depth + 1 < dims.length ? level(list, depth + 1, p) : lineRows(o, depth + 1)) : null}
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
            <p className="mt-1">Нажмите ›, чтобы раскрыть вглубь: группа → ТЗ → состав (мех и подкладка по лотам со ссылками на лот и закупку, шкуры подрядчика, расходы, работа). Номер ТЗ ведёт в карточку ТЗ.</p>
            <p className="mt-1"><b>Всего</b> = мех + подкладка + работа + 4%{c4 === "on" ? "" : " (сейчас «Без 4%»)"} + расходы ТЗ и прочее. «Изд., шт.» — без ремонта. Режим «С НДС / Без НДС» — общий переключатель в шапке.</p>
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
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className={ARROW_TH} aria-label="Раскрыть" />
              <th className={TH_LEFT}>{mode.label}</th>
              <th className={TH}>Изд., шт.</th>
              <th className={TH}>На изделие</th>
              <th className={TH + " border-l border-neutral-100"}>Всего</th>
              <th className={TH}>Мех</th>
              <th className={TH}>Подкладка</th>
              <th className={TH}>Работа</th>
              {c4 === "on" ? <th className={TH}>4%</th> : null}
              <th className={TH}>Расходы и прочее</th>
              {showPay ? <><th className={TH + " border-l border-neutral-100"}>Оплачено</th><th className={TH}>К оплате по работе</th></> : null}
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

