"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cn, formatMoney, formatPercent } from "@/lib/utils";
import { useVatDisplay } from "@/lib/vat-display";
import { InfoHint } from "@/components/info-hint";
import { LocalFilterBar } from "@/components/filters/filter-bar";
import { TH, THGroup } from "@/components/table-head";
import { UNIT } from "@/lib/units";
import { TotalLabel } from "@/components/total-label";
import { TILE_BOX, TileHead, TileValue, TileCaption } from "../../dashboard/tile";

export type HidesOrderRow = {
  orderId: string; number: string; label: string; batch: string; payYear: number; article: string; category: string; units: number;
  incl: number; excl: number; pinned: boolean;
};
export type HidesPayment = { id: string; iso: string; date: string; year: number; label: string; doc: string | null; hides: number; amount: number; href: string; confirmed: boolean };

import { useClientSort } from "@/lib/use-client-sort";
const D = () => <span className="text-neutral-500">–</span>;
const money = (v: number) => (Math.abs(v) < 0.5 ? <D /> : formatMoney(v.toFixed(2)));
const TD = "whitespace-nowrap px-2 py-1.5 text-right tabular-nums";
const BL = " border-l border-neutral-200";

/**
 * Шкуры подрядчика: плитки, таблицы «По партиям», «По ТЗ» и «Оплаты» (основания). Те же суммы, что входят в Главную (мех «Использовано» и «Куплено»):
 * сумма берётся из оплат производства по году платежа и делится по партиям и ТЗ (contractor-hides.ts).
 */
export function HidesView({ orders, payments }: { orders: HidesOrderRow[]; payments: HidesPayment[] }) {
  const { mode: vat } = useVatDisplay();
  const [batch, setBatch] = useState<string>("all");
  const [q, setQ] = useState("");
  const val = (r: { incl: number; excl: number }) => (vat === "excl" ? r.excl : r.incl);
  const batches = useMemo(() => Array.from(new Set(orders.map((o) => o.batch))).sort((a, b) => a.localeCompare(b, "ru", { numeric: true })), [orders]);
  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => orders.filter((o) => (batch === "all" || o.batch === batch) && (!needle || [o.number, o.label, o.article, o.category].some((x) => x.toLowerCase().includes(needle)))).sort((a, b) => b.incl - a.incl),
    [orders, batch, needle],
  );
  const T = shown.reduce((a, o) => ({ incl: a.incl + o.incl, excl: a.excl + o.excl, units: a.units + o.units }), { incl: 0, excl: 0, units: 0 });
  const byBatch = useMemo(() => {
    const m = new Map<string, { batch: string; payYear: number; incl: number; excl: number; n: number }>();
    for (const o of orders) {
      const k = `${o.batch}|${o.payYear}`;
      const c = m.get(k) ?? { batch: o.batch, payYear: o.payYear, incl: 0, excl: 0, n: 0 };
      c.incl += o.incl; c.excl += o.excl; c.n += 1;
      m.set(k, c);
    }
    return Array.from(m.values()).sort((a, b) => a.batch.localeCompare(b.batch, "ru", { numeric: true }));
  }, [orders]);
  const all = orders.reduce((a, o) => ({ incl: a.incl + o.incl, excl: a.excl + o.excl }), { incl: 0, excl: 0 });
  const paidTotal = payments.reduce((a, p) => a + p.hides, 0);
  // Сортировка по клику на заголовок: по ТЗ и по платежам (▲/▼, повторный клик меняет направление).
  const ord = useClientSort<HidesOrderRow>({
    tz: (o) => o.label, batch: (o) => o.batch, year: (o) => o.payYear, article: (o) => o.article, units: (o) => o.units,
    sum: (o) => val(o), vat: (o) => o.incl - o.excl, share: (o) => o.incl, per: (o) => (o.units > 0 ? val(o) / o.units : null),
  });
  const pay = useClientSort<HidesPayment>({ date: (p) => p.iso, label: (p) => p.label, doc: (p) => p.doc, amount: (p) => p.amount, hides: (p) => p.hides, ok: (p) => (p.confirmed ? 1 : 0) });
  const shownPays = pay.sort(payments);

  return (
    <div className="flex flex-col gap-4">
      <div className="print:hidden">
        <LocalFilterBar
          title="Фильтры ТЗ"
          oneRow
          hideChips
          controls={[
            { type: "text", name: "q", label: "Поиск по ТЗ", placeholder: "№ ТЗ, артикул" },
            ...(batches.length > 1 ? [{ type: "multi" as const, name: "batch", label: "Партия производства", single: true, allLabel: "Все", options: batches.map((b) => ({ value: b, label: b })) }] : []),
          ]}
          values={{ q: q ? [q] : [], batch: batch === "all" ? [] : [batch] }}
          onChange={(name, v) => { if (name === "q") setQ(v[0] ?? ""); else if (name === "batch") setBatch(v[0] ?? "all"); }}
          onReset={() => { setQ(""); setBatch("all"); }}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="hides-tiles">
        <div className={TILE_BOX}><TileHead>Сумма, ₽</TileHead><TileValue compact>{formatMoney(val(all).toFixed(2))}</TileValue><TileCaption>{vat === "excl" ? "без НДС" : "с НДС"}</TileCaption></div>
        {vat === "excl" ? <div className={TILE_BOX}><TileHead>С НДС, ₽</TileHead><TileValue compact>{formatMoney(all.incl.toFixed(2))}</TileValue><TileCaption>как в «Оплатах»</TileCaption></div> : null}
        <div className={TILE_BOX}><TileHead>НДС, ₽</TileHead><TileValue compact>{formatMoney((all.incl - all.excl).toFixed(2))}</TileValue><TileCaption><span title="Партия 8 — 20 %, партия 7 — 22 %">20 % · 22 %</span></TileCaption></div>
        <div className={TILE_BOX}><TileHead>Оплачено, ₽</TileHead><TileValue compact>{formatMoney(paidTotal.toFixed(2))}</TileValue><TileCaption>в счетах за пошив</TileCaption></div>
        <div className={TILE_BOX}><TileHead>Долг, ₽</TileHead><TileValue compact>–</TileValue><TileCaption>долга нет</TileCaption></div>
        <div className={TILE_BOX}><TileHead>Платежей / ТЗ</TileHead><TileValue compact>{payments.length} / {orders.length}</TileValue><TileCaption>партий: {batches.length}</TileCaption></div>
      </div>

      <section aria-labelledby="h-batch" className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 id="h-batch" className="text-base font-semibold">По партиям производства</h2>
          <InfoHint label="Как шкуры делятся по партиям" wide>
            <p>Сумма берётся из оплат производства по году платежа и относится к партии, к которой в примечании платежа отнесён остаток: партия 7 (п/п №22618 от 21.01.2026, счёт №1) и партия 8 (п/п №82173 от 27.11.2025, остаток аванса). Внутри партии сумма делится между её ТЗ: закреплённый по документам ТЗ — своя сумма, остальные — пропорционально изделиям.</p>
          </InfoHint>
        </div>
        <div className="scroll-hint overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full table-fixed text-sm" style={{ minWidth: 640 }}>
            <thead><tr className="border-b border-neutral-200"><TH align="left" label="Партия" /><TH label="Год оплаты" /><TH label="ТЗ" unit={UNIT.pcs} /><TH sep label="Без НДС" unit={UNIT.rub} /><TH label="НДС" unit={UNIT.rub} /><TH label="С НДС" unit={UNIT.rub} /></tr></thead>
            <tbody>
              {byBatch.map((b) => (
                <tr key={`${b.batch}${b.payYear}`} className="border-t border-neutral-100">
                  <td className="px-2 py-1.5 text-left"><Link href={`/production/batches/${b.batch}`} className="text-blue-700 hover:underline">Партия {b.batch}<span aria-hidden className="ml-1 text-[11px] text-neutral-600">↗</span></Link></td>
                  <td className={TD}>{b.payYear}</td><td className={TD}>{b.n}</td>
                  <td className={TD + BL}>{money(b.excl)}</td><td className={TD}>{money(b.incl - b.excl)}</td><td className={TD}>{money(b.incl)}</td>
                </tr>
              ))}
              {byBatch.length === 0 ? <tr><td colSpan={6} className="px-3 py-5 text-center text-neutral-500">За выбранный год шкур подрядчика нет.</td></tr> : (
                <tr className="row-total"><td className="px-2 py-2 text-left"><TotalLabel unit="₽" /></td><td className={TD} /><td className={TD}>{orders.length}</td><td className={TD + BL}>{money(all.excl)}</td><td className={TD}>{money(all.incl - all.excl)}</td><td className={TD}>{money(all.incl)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="h-orders" className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 id="h-orders" className="text-base font-semibold">По ТЗ</h2>
          <InfoHint label="Как читать таблицу по ТЗ" wide>
            <p>В каких ТЗ учтены шкуры подрядчика. Количество шкур в документах не указано (оплачена стоимость, а не шкуры), поэтому «шкур» и средняя цена за шкуру — «—»; цены в $ нет. Суммы входят в «Использовано» меха на Главной (свакара) и в себестоимость ТЗ.</p>
          </InfoHint>
        </div>
        <div className="scroll-hint overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full table-fixed text-sm" style={{ minWidth: 900 }}>
            <thead>
              <tr><THGroup sep={false} colSpan={5}>ТЗ</THGroup><THGroup colSpan={4}>Стоимость шкур подрядчика</THGroup></tr>
              <tr className="border-b border-neutral-200"><TH align="left" label="ТЗ" {...ord.th("tz")} /><TH label="Партия" {...ord.th("batch")} /><TH label="Год оплаты" {...ord.th("year")} /><TH align="left" label="Артикул" {...ord.th("article")} /><TH label="Изд." unit={UNIT.pcs} {...ord.th("units")} /><TH sep label={`Сумма (${vat === "excl" ? "без НДС" : "с НДС"})`} unit={UNIT.rub} {...ord.th("sum")} /><TH label="НДС" unit={UNIT.rub} {...ord.th("vat")} /><TH label="Доля" unit={UNIT.pct} {...ord.th("share")} /><TH label="На изделие" unit={UNIT.rub} {...ord.th("per")} /></tr>
            </thead>
            <tbody>
              {ord.sort(shown).map((o) => (
                <tr key={o.orderId} className="border-t border-neutral-100">
                  <td className="px-2 py-1.5 text-left"><Link href={`/production/${o.orderId}`} className="text-blue-700 hover:underline" title={`Внутренний номер заказа ${o.number}`}>{o.label}</Link>{o.pinned ? <span className="ml-1.5 rounded-full bg-neutral-100 px-1.5 text-[11px] text-neutral-500" title="Сумма закреплена за этим ТЗ по документам">по документу</span> : null}</td>
                  <td className={TD}>{o.batch}</td><td className={TD}>{o.payYear}</td>
                  <td className="truncate px-2 py-1.5 text-left text-xs" title={`${o.article} · ${o.category}`}>{o.article}<span className="text-neutral-500"> · {o.category}</span></td>
                  <td className={TD}>{o.units > 0 ? o.units : <D />}</td>
                  <td className={TD + BL}>{money(val(o))}</td><td className={TD}>{money(o.incl - o.excl)}</td>
                  <td className={TD + " text-neutral-600"}>{all.incl > 0 ? formatPercent((o.incl / all.incl) * 100) : <D />}</td>
                  <td className={TD}>{o.units > 0 ? money(val(o) / o.units) : <D />}</td>
                </tr>
              ))}
              {shown.length === 0 ? <tr><td colSpan={9} className="px-3 py-5 text-center text-neutral-500">Нет ТЗ по выбранным условиям.</td></tr> : (
                <tr className="row-total"><td className="px-2 py-2 text-left" colSpan={4}><TotalLabel unit="₽" avg /></td><td className={TD}>{T.units > 0 ? T.units : <D />}</td><td className={TD + BL}>{money(vat === "excl" ? T.excl : T.incl)}</td><td className={TD}>{money(T.incl - T.excl)}</td><td className={TD}>{all.incl > 0 ? formatPercent((T.incl / all.incl) * 100) : <D />}</td><td className={TD}>{T.units > 0 ? money((vat === "excl" ? T.excl : T.incl) / T.units) : <D />}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="h-pay" className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 id="h-pay" className="text-base font-semibold">Оплаты и документы-основания</h2>
          <InfoHint label="Что это за оплаты" wide>
            <p>Платежи производства, в которых после разнесения по ТЗ остался нераспределённый остаток с пометкой «шкур…» в основании или заметке: эта часть — шкуры подрядчика. Основание — п/п и счёт как записаны в платеже; ссылка ведёт в «Оплаты» на дату платежа.</p>
          </InfoHint>
        </div>
        <div className="scroll-hint overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full table-fixed text-sm" style={{ minWidth: 760 }}>
            <thead><tr className="border-b border-neutral-200"><TH align="left" label="Дата" {...pay.th("date")} /><TH align="left" label="Платёж" {...pay.th("label")} /><TH align="left" label="Основание (п/п, счёт)" {...pay.th("doc")} /><TH sep label="Платёж всего" unit={UNIT.rub} {...pay.th("amount")} /><TH label="Из них шкуры" unit={UNIT.rub} {...pay.th("hides")} /><TH label="Подтв." {...pay.th("ok")} /></tr></thead>
            <tbody>
              {shownPays.map((p) => (
                <tr key={p.id} className="border-t border-neutral-100">
                  <td className="px-2 py-1.5 text-left tabular-nums">{p.date}</td>
                  <td className="px-2 py-1.5 text-left"><Link href={p.href} className="text-blue-700 hover:underline">{p.label}<span aria-hidden className="ml-1 text-[11px] text-neutral-600">↗</span></Link></td>
                  <td className="truncate px-2 py-1.5 text-left text-xs" title={p.doc ?? ""}>{p.doc ?? <D />}</td>
                  <td className={TD + BL}>{money(p.amount)}</td><td className={TD}>{money(p.hides)}</td>
                  <td className={TD + " text-xs"}>{p.confirmed ? "да" : "ждёт"}</td>
                </tr>
              ))}
              {shownPays.length === 0 ? <tr><td colSpan={6} className="px-3 py-5 text-center text-neutral-500">Платежей нет.</td></tr> : (
                <tr className="row-total"><td className="px-2 py-2 text-left" colSpan={3}><TotalLabel unit="₽" /></td><td className={TD + BL}>{money(shownPays.reduce((a, p) => a + p.amount, 0))}</td><td className={TD}>{money(paidTotal)}</td><td className={TD} /></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
