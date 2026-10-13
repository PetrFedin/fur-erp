"use client";

import Link from "next/link";
import { TH as Head } from "@/components/table-head";
import { useState, type ReactNode } from "react";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty, formatShare } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import type { DrillLine, DrillOrder } from "@/lib/dashboard-drill";
import { sumOrders, sumTotal } from "@/lib/orders-sum";
import { Dash, SCROLL_BOX } from "@/components/tree-table";
import { TotalLabel } from "@/components/total-label";

const TH = "whitespace-nowrap px-2 py-1.5 text-xs font-medium text-neutral-500";
const TD = "whitespace-nowrap px-2 py-1.5";
const money = (v: number) => (Math.abs(v) < 0.5 ? <Dash /> : formatMoney(Math.round(v)));
/** Строк больше — показываем первые LIMIT и кнопку «Показать все»; итоги ниже считаются по всем строкам. */
const LIMIT = 8;
const pct = (v: number) => (v > 0 ? formatShare(v) : "");

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
  /** Сумма стоит в отдельном столбце («Доп. расходы» или «Работа»), а в «Всего» — «—». */
  col?: "work" | "exp";
};

/**
 * «Состав себестоимости по лотам» одного ТЗ — плоская таблица: каждая строка списания разнесена по столбцам
 * (лот, закупка, аукцион, материал, количество, цена, ставка НДС, сумма, НДС, 4%, всего, доля), а шкуры подрядчика, расходы и работа — отдельными строками.
 * Данные те же, что в окне «Стоимость производства» на Главной и в разделе «Изделия» (loadDrillOrders), поэтому итоги совпадают.
 */
export function CompositionTable({ order: o, c4, vatRateByLot, title = "Состав себестоимости по лотам", bare = false }: { order: DrillOrder; c4: "on" | "off"; vatRateByLot: Record<string, number>; title?: string; /** Без заголовка: таблица лежит в свёрнутом блоке карточки ТЗ со своим заголовком. */ bare?: boolean }) {
  const { mode: vat } = useVatDisplay();
  const [showAll, setShowAll] = useState(false);
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
    // НДС строки вместе с 4% (l.i / l.e уже с надбавкой) — та же сумма, что плитка «НДС в списаниях» карточки ТЗ.
    const vatPart = incl ? l.i - l.e : 0;
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
  // Доп. расходы ТЗ — по статьям, в своём столбце «Доп. расходы» (не в «Работе»: работа — оплата подрядчику за пошив).
  if (Math.abs(o.exp) > 0.5) {
    const xs = (o.xs ?? []).filter((x) => Math.abs(x.a) > 0.005);
    const rest = o.exp - xs.reduce((a, x) => a + x.a, 0);
    xs.forEach((x, i) => rows.push({ key: `e${i}`, kind: `Доп. расходы · ${x.n}`, what: <span className="text-neutral-500">без НДС и без 4%</span>, base: 0, vat: 0, c4: 0, total: x.a, col: "exp" }));
    if (Math.abs(rest) > 0.5 || xs.length === 0) rows.push({ key: "e", kind: "Доп. расходы", what: <span className="text-neutral-500">без НДС и без 4%</span>, base: 0, vat: 0, c4: 0, total: rest, col: "exp" });
  }
  const res = incl ? o.resI : o.resE;
  if (Math.abs(res) > 0.5) rows.push({ key: "r", kind: "Прочее", what: <span className="text-neutral-500">разница между итогом ТЗ и суммой строк</span>, base: res, vat: 0, c4: 0, total: res });
  if (Math.abs(o.work) > 0.5) rows.push({ key: "w", kind: "Работа заказчику", what: <span className="text-neutral-500">{qty > 0 ? <>{formatMoney(Math.round(o.work / qty))} за изделие × {formatQty(qty)} шт.</> : "цена работы × количество"}</span>, base: 0, vat: 0, c4: 0, total: o.work, col: "work" });

  const modeLabel = incl ? "с НДС" : "без НДС";
  return (
    <section aria-label={title} className="space-y-2" id={bare ? undefined : "tz-composition"}>
      {bare ? (
        <p className="text-xs text-neutral-500">
          Каждая строка — одно списание лота: лот и закупка (ссылки), аукцион, материал, количество, цена за единицу ({modeLabel}, без 4%), ставка НДС лота, сумма, НДС внутри суммы (вместе с 4%), 4%, всего и доля в себестоимости ТЗ.
          Шкуры подрядчика, доп. расходы и работа — отдельными строками в своих столбцах (в «Всего» у них «—», в итог входят). Итог совпадает с окном «Стоимость производства» на Главной и с разделом «Изделия».
        </p>
      ) : (
      <div className="flex items-center gap-2">
        <h2 className="block-title">{title}</h2>
        <InfoHint label={`Как читать: ${title}`} wide>
          <p>Каждая строка — одно списание лота в этом ТЗ: <b>лот</b> и <b>закупка</b> (ссылки), <b>аукцион</b> — партия закупки, <b>материал</b> и вид меха, <b>кол-во</b> (шкуры или метры), <b>цена за ед.</b> ({modeLabel}, без 4%), <b>ставка НДС</b> лота, <b>сумма</b> без 4%, <b>НДС</b> внутри суммы (вместе с 4%), <b>4%</b> отдельно, <b>всего</b> = сумма + 4%, <b>доля</b> в себестоимости ТЗ.</p>
          <p className="mt-1">Шкуры подрядчика, доп. расходы ТЗ и работа (цена работы × количество) — отдельными строками; их суммы стоят в столбцах «Доп. расходы» и «Работа» (в «Всего» у них «—», в итог они входят). Итог совпадает с окном «Стоимость производства» на Главной и с разделом «Изделия».</p>
        </InfoHint>
      </div>
      )}
      <div className={SCROLL_BOX}>
        <table className="w-full min-w-[1060px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className={TH + " text-left"}>Статья</th>
              <th className={TH + " text-left"}>Лот</th>
              <th className={TH + " text-left"}>Закупка</th>
              <th className={TH + " text-left"}>Аукцион</th>
              <th className={TH + " text-left"}>Материал</th>
              <Head label="Кол-во" align="right" />
              <Head label={`Цена за ед. ${modeLabel}`} unit="₽" align="right" />
              <Head label="Ставка НДС" unit="%" align="right" />
              <Head label={`Сумма ${modeLabel}`} unit="₽" align="right" sep />
              <Head label="в т.ч. НДС" unit="₽" align="right" />
              {c4 === "on" ? <Head label="4%" unit="₽" align="right" after={<InfoHint label="Что такое 4%"><p>Надбавка 4% к сырью (меху и подкладке).</p></InfoHint>} /> : null}
              <Head label="Всего" unit="₽" align="right" sep />
              <Head label="Доп. расходы" unit="₽" align="right" />
              <Head label="Работа" unit="₽" align="right" />
              <Head label="Доля" unit="%" align="right" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={c4 === "on" ? 15 : 14} className="px-3 py-6 text-center text-neutral-500">Списаний и расходов нет</td></tr>
            ) : (showAll ? rows : rows.slice(0, LIMIT)).map((r) => (
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
                <td className={TD + " border-l border-neutral-200 text-right font-medium tabular-nums"}>{r.col ? <Dash /> : money(r.total)}</td>
                <td className={TD + " text-right tabular-nums"}>{r.col === "exp" ? money(r.total) : <Dash />}</td>
                <td className={TD + " text-right tabular-nums"}>{r.col === "work" ? money(r.total) : <Dash />}</td>
                <td className={TD + " text-right tabular-nums text-neutral-500"}>{grand ? pct(r.total / grand) : ""}</td>
              </tr>
            ))}
            {rows.length > LIMIT ? (
              <tr>
                <td colSpan={c4 === "on" ? 15 : 14} className="px-2 py-1 text-left">
                  <button type="button" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll} className="text-xs text-blue-700 hover:underline">
                    {showAll ? `Свернуть (показаны все ${rows.length})` : `Показать все (${rows.length})`}
                  </button>
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr className="row-total">
              <td className={TD} colSpan={5}><TotalLabel extra="по ТЗ" /></td>
              <td className={TD + " text-right tabular-nums"}>{qty > 0 ? <>{formatQty(qty)} <span className="text-xs font-normal text-neutral-500">шт.</span></> : <Dash />}</td>
              <td className={TD + " text-right tabular-nums"}>{qty > 0 ? <><span className="text-xs font-normal text-neutral-500">на изд. </span>{money(grand / qty)}</> : <Dash />}</td>
              <td className={TD} />
              <td className={TD + " border-l border-neutral-200 text-right tabular-nums"}>{money(rows.reduce((a, r) => a + r.base, 0))}</td>
              <td className={TD + " text-right tabular-nums"}>{money(rows.reduce((a, r) => a + r.vat, 0))}</td>
              {c4 === "on" ? <td className={TD + " text-right tabular-nums"}>{money(rows.reduce((a, r) => a + r.c4, 0))}</td> : null}
              <td className={TD + " border-l border-neutral-200 text-right tabular-nums"}>{money(grand)}</td>
              <td className={TD + " text-right tabular-nums"}>{money(s.exp)}</td>
              <td className={TD + " text-right tabular-nums"}>{money(s.work)}</td>
              <td className={TD + " text-right tabular-nums text-neutral-500"}>{grand ? "100,0%" : ""}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-neutral-500">
        Мех {money(s.fur)} · подкладка {money(s.lining)}{c4 === "on" ? <> · 4% {money(s.c4)}</> : null} · прочее {money(s.other - s.exp)} · доп. расходы {money(s.exp)} · работа {money(s.work)}
      </p>
    </section>
  );
}
