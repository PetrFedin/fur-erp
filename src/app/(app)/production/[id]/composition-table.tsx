"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import type { DrillLine, DrillOrder } from "@/lib/dashboard-drill";
import { sumOrders, sumTotal } from "@/lib/orders-sum";
import { Dash, SCROLL_BOX } from "@/components/tree-table";

const TH = "whitespace-nowrap px-2 py-1.5 text-xs font-medium text-neutral-500";
const TD = "whitespace-nowrap px-2 py-1.5";
const money = (v: number) => (Math.abs(v) < 0.5 ? <Dash /> : formatMoney(Math.round(v)));
const pct = (v: number) => (v > 0 ? `${(v * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%` : "");

type Row = {
  key: string;
  kind: string;
  tone?: string;
  lot?: ReactNode;
  purchase?: ReactNode;
  auction?: ReactNode;
  what: ReactNode;
  qty?: ReactNode;
  price?: ReactNode;
  vatRate?: ReactNode;
  base: number;
  vat: number;
  c4: number;
  total: number;
};

/**
 * «Состав себестоимости по лотам» одного ТЗ — плоская таблица: каждая строка списания разнесена по столбцам
 * (лот, закупка, аукцион, материал, количество, цена, ставка НДС, сумма, НДС, 4%, всего, доля), а шкуры подрядчика, расходы и работа — отдельными строками.
 * Данные те же, что в окне «Стоимость производства» на Главной и в разделе «Изделия» (loadDrillOrders), поэтому итоги совпадают.
 */
export function CompositionTable({ order: o, c4, vatRateByLot, title = "Состав себестоимости по лотам" }: { order: DrillOrder; c4: "on" | "off"; vatRateByLot: Record<string, number>; title?: string }) {
  const { mode: vat } = useVatDisplay();
  const incl = vat === "incl";
  const s = sumOrders([o], vat);
  const grand = sumTotal(s);
  const qty = o.qty;

  const rows: Row[] = [];
  const lines = [...o.lines].sort((a, b) => (a.k === b.k ? 0 : a.k === "f" ? -1 : 1));
  lines.forEach((l: DrillLine, i) => {
    const c = incl ? l.ci : l.ce;
    const total = incl ? l.i : l.e;
    const base = total - c;
    const vatPart = incl ? (l.i - l.ci) - (l.e - l.ce) : 0;
    const unit = l.k === "l" ? "м" : "шк.";
    const rate = vatRateByLot[l.lot];
    rows.push({
      key: `l${i}`,
      kind: l.k === "l" ? "Подкладка" : "Мех",
      lot: <Link href={`/analytics/raw/lot/${l.lot}`} className="text-blue-700 hover:underline">{l.ln ?? "без номера"}</Link>,
      purchase: l.pid ? <Link href={`/purchases/${l.pid}`} className="text-blue-700 hover:underline">{l.pn ?? "закупка"}</Link> : <Dash />,
      auction: l.au || <Dash />,
      what: <>{l.n}{l.k === "f" && l.fu ? <span className="text-neutral-400"> · {l.fu}</span> : null}</>,
      qty: <>{formatQty(l.q)} <span className="text-xs text-neutral-500">{unit}</span></>,
      price: l.q > 0 ? formatMoney(Math.round(base / l.q)) : <Dash />,
      vatRate: rate != null ? `${rate}%` : <Dash />,
      base,
      vat: vatPart,
      c4: c,
      total,
    });
  });
  const hides = incl ? o.hI : o.hE;
  if (Math.abs(hides) > 0.5) rows.push({ key: "h", kind: "Шкуры подрядчика", what: <span className="text-neutral-500">оплачены в составе счетов за пошив, в ТЗ не списаны</span>, base: hides, vat: 0, c4: 0, total: hides });
  if (Math.abs(o.exp) > 0.5) rows.push({ key: "e", kind: "Расходы ТЗ", what: <span className="text-neutral-500">без НДС и без 4%</span>, base: o.exp, vat: 0, c4: 0, total: o.exp });
  const res = incl ? o.resI : o.resE;
  if (Math.abs(res) > 0.5) rows.push({ key: "r", kind: "Прочее", what: <span className="text-neutral-500">разница между итогом ТЗ и суммой строк</span>, base: res, vat: 0, c4: 0, total: res });
  if (Math.abs(o.work) > 0.5) rows.push({ key: "w", kind: "Работа заказчику", what: <span className="text-neutral-500">{qty > 0 ? <>{formatMoney(Math.round(o.work / qty))} за изделие × {formatQty(qty)} шт.</> : "цена работы × количество"}</span>, base: o.work, vat: 0, c4: 0, total: o.work });

  const modeLabel = incl ? "с НДС" : "без НДС";
  return (
    <section aria-label={title} className="space-y-2" id="tz-composition">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <InfoHint label={`Как читать: ${title}`} wide>
          <p>Каждая строка — одно списание лота в этом ТЗ: <b>лот</b> и <b>закупка</b> (ссылки), <b>аукцион</b> — партия закупки, <b>материал</b> и вид меха, <b>кол-во</b> (шкуры или метры), <b>цена за ед.</b> ({modeLabel}, без 4%), <b>ставка НДС</b> лота, <b>сумма</b> без 4%, <b>НДС</b> внутри суммы, <b>4%</b> отдельно, <b>всего</b> = сумма + 4%, <b>доля</b> в себестоимости ТЗ.</p>
          <p className="mt-1">Шкуры подрядчика, расходы и работа (цена работы × количество) — отдельными строками. Итог равен «Всего себестоимость» выше и совпадает с окном «Стоимость производства» на Главной и с разделом «Изделия». Режимы «С НДС / Без НДС» и «С 4% / Без 4%» — общие переключатели шапки.</p>
        </InfoHint>
      </div>
      <div className={SCROLL_BOX}>
        <table className="w-full min-w-[1060px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className={TH + " text-left"}>Статья</th>
              <th className={TH + " text-left"}>Лот</th>
              <th className={TH + " text-left"}>Закупка</th>
              <th className={TH + " text-left"}>Аукцион</th>
              <th className={TH + " text-left"}>Материал</th>
              <th className={TH + " text-right"}>Кол-во</th>
              <th className={TH + " text-right"}>Цена за ед., {modeLabel}</th>
              <th className={TH + " text-right"}>Ставка НДС</th>
              <th className={TH + " border-l border-neutral-100 text-right"}>Сумма, {modeLabel}</th>
              <th className={TH + " text-right"}>в т.ч. НДС</th>
              {c4 === "on" ? <th className={TH + " text-right"}>4%</th> : null}
              <th className={TH + " border-l border-neutral-100 text-right"}>Всего</th>
              <th className={TH + " text-right"}>Доля</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={c4 === "on" ? 13 : 12} className="px-3 py-6 text-center text-neutral-500">Списаний и расходов нет</td></tr>
            ) : rows.map((r) => (
              <tr key={r.key} className="border-b border-neutral-100 hover:bg-neutral-50/60">
                <td className={TD + " font-medium"}>{r.kind}</td>
                <td className={TD}>{r.lot ?? ""}</td>
                <td className={TD}>{r.purchase ?? ""}</td>
                <td className={TD + " max-w-[12rem] truncate"} title={typeof r.auction === "string" ? r.auction : undefined}>{r.auction ?? ""}</td>
                <td className={TD + " max-w-[16rem] truncate"}>{r.what}</td>
                <td className={TD + " text-right tabular-nums"}>{r.qty ?? ""}</td>
                <td className={TD + " text-right tabular-nums"}>{r.price ?? ""}</td>
                <td className={TD + " text-right tabular-nums"}>{r.vatRate ?? ""}</td>
                <td className={TD + " border-l border-neutral-100 text-right tabular-nums"}>{money(r.base)}</td>
                <td className={TD + " text-right tabular-nums text-neutral-600"}>{money(r.vat)}</td>
                {c4 === "on" ? <td className={TD + " text-right tabular-nums"}>{money(r.c4)}</td> : null}
                <td className={TD + " border-l border-neutral-100 text-right font-medium tabular-nums"}>{money(r.total)}</td>
                <td className={TD + " text-right tabular-nums text-neutral-500"}>{grand ? pct(r.total / grand) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-neutral-300 bg-neutral-50 font-semibold">
              <td className={TD} colSpan={5}>Итого по ТЗ</td>
              <td className={TD + " text-right tabular-nums"}>{qty > 0 ? <>{formatQty(qty)} <span className="text-xs font-normal text-neutral-500">шт.</span></> : <Dash />}</td>
              <td className={TD + " text-right tabular-nums"}>{qty > 0 ? <><span className="text-xs font-normal text-neutral-500">на изд. </span>{money(grand / qty)}</> : <Dash />}</td>
              <td className={TD} />
              <td className={TD + " border-l border-neutral-100 text-right tabular-nums"}>{money(rows.reduce((a, r) => a + r.base, 0))}</td>
              <td className={TD + " text-right tabular-nums"}>{money(rows.reduce((a, r) => a + r.vat, 0))}</td>
              {c4 === "on" ? <td className={TD + " text-right tabular-nums"}>{money(rows.reduce((a, r) => a + r.c4, 0))}</td> : null}
              <td className={TD + " border-l border-neutral-100 text-right tabular-nums"}>{money(grand)}</td>
              <td className={TD + " text-right tabular-nums text-neutral-500"}>{grand ? "100%" : ""}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-neutral-500">
        Мех {money(s.fur)} · подкладка {money(s.lining)}{c4 === "on" ? <> · 4% {money(s.c4)}</> : null} · расходы и прочее {money(s.other)} · работа {money(s.work)}
      </p>
    </section>
  );
}
