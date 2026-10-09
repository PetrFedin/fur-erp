"use client";

import { useState } from "react";
import Link from "next/link";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import { ProductionModal } from "./production-modal";
import { ProductionTable } from "./production-table";
import { AveragesTile } from "./averages";
import { WidgetRow } from "@/components/widget-row";
import { TILE_BOX, TileCaption, TileHead, TileValue } from "./tile";
import { BridgeHint, type ModeInfo } from "./mode-line";
import { formatCompactMoney } from "./compact";

export type ProdNums = { repairOrders: number; repairQty: number; repairCostIncl: number; repairCostExcl: number; orders: number; qty: number; costIncl: number; costExcl: number; work: number; furIncl: number; furExcl: number; liningIncl: number; liningExcl: number; matIncl: number; matExcl: number; c4Incl: number; c4Excl: number };
export type ProdBridge = { usedBase: { incl: number; excl: number }; comparable: boolean; lotFilters: boolean; yearOnly: boolean };

const addNums = (a: ProdNums, b: ProdNums): ProdNums => ({ repairOrders: a.repairOrders + b.repairOrders, repairQty: a.repairQty + b.repairQty, repairCostIncl: a.repairCostIncl + b.repairCostIncl, repairCostExcl: a.repairCostExcl + b.repairCostExcl, orders: a.orders + b.orders, qty: a.qty + b.qty, costIncl: a.costIncl + b.costIncl, costExcl: a.costExcl + b.costExcl, work: a.work + b.work, furIncl: a.furIncl + b.furIncl, furExcl: a.furExcl + b.furExcl, liningIncl: a.liningIncl + b.liningIncl, liningExcl: a.liningExcl + b.liningExcl, matIncl: a.matIncl + b.matIncl, matExcl: a.matExcl + b.matExcl, c4Incl: a.c4Incl + b.c4Incl, c4Excl: a.c4Excl + b.c4Excl });

type VatPair = { incl: number; excl: number };

export function ProductionBlock({ hides, c4Parts, years, done, work, c4, search, info, bridge }: { hides: VatPair; c4Parts: { fur: VatPair; lining: VatPair }; years: { label: string; qty: number }[]; done: ProdNums; work: ProdNums; c4: "on" | "off"; search: Record<string, string[]>; info: ModeInfo; bridge: ProdBridge }) {
  const { mode: vat } = useVatDisplay();
  const [open, setOpen] = useState<null | "done" | "work" | "all">(null);
  // Отметка «завершён» не ведётся строго, поэтому себестоимость — факт списания по всем ТЗ (завершённые + в работе).
  const fact = addNums(done, work);
  const cost = (n: ProdNums) => (vat === "incl" ? n.costIncl : n.costExcl);
  const repairCost = vat === "incl" ? fact.repairCostIncl : fact.repairCostExcl;
  const avg = fact.qty > 0 ? (cost(fact) - repairCost) / fact.qty : null;
  const D = vat === "incl"
    ? { fur: fact.furIncl + hides.incl, lining: fact.liningIncl, c4: fact.c4Incl }
    : { fur: fact.furExcl + hides.excl, lining: fact.liningExcl, c4: fact.c4Excl };
  // Шкуры подрядчика входят в мех (оплачены в составе пошива), поэтому и в себестоимость.
  const costAll = cost(fact) + (vat === "incl" ? hides.incl : hides.excl);
  const otherRaw = costAll - D.fur - D.lining - (c4 === "on" ? D.c4 : 0);
  const other = Math.abs(otherRaw) < 0.5 ? 0 : otherRaw;
  const total = costAll + fact.work;
  const parts = [
    { k: "Мех", v: D.fur, with4: D.fur + c4Parts.fur[vat] },
    { k: "Подкладка", v: D.lining, with4: D.lining + c4Parts.lining[vat] },
    ...(c4 === "on" ? [{ k: "Надбавка 4%", v: D.c4, with4: undefined as number | undefined }] : []),
    ...(other !== 0 ? [{ k: "Расходы ТЗ и прочее", v: other, with4: undefined as number | undefined }] : []),
    { k: "Работа", v: fact.work, with4: undefined as number | undefined },
  ];
  void info;
  const vatW = vat === "incl" ? "с НДС" : "без НДС";
  const c4W = c4 === "on" ? "с 4%" : "без 4%";
  const money = (v: number) => formatMoney(v.toFixed(2));
  const active = open === "work" ? work : open === "all" ? fact : done;

  return (
    <section aria-labelledby="dash-prod" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id="dash-prod" className="text-base font-semibold">Производство</h2>
          <ProdBridgeHint done={fact} c4={c4} vat={vat} bridge={bridge} />
        </div>
        <div className="flex items-center gap-3 text-xs text-neutral-500">
          <Link href="/production" className="text-blue-700 hover:underline print:hidden">→ ТЗ</Link>
        </div>
      </div>
      <WidgetRow id="prod" title="Производство — итоги">
      <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-3 print:grid-cols-3">
        <div className="relative">
          <button type="button" onClick={() => setOpen("all")} aria-haspopup="dialog" aria-label="Произведено изделий — открыть себестоимость по статьям" className={TILE_BOX + " w-full text-left shadow-sm transition hover:border-neutral-400 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 print:shadow-none"}>
            <TileHead>Произведено</TileHead>
            <TileValue>{formatQty(fact.qty)} шт.</TileValue>
            <TileCaption>{fact.orders} ТЗ · состав →{fact.repairOrders > 0 ? ` · ремонт ${fact.repairOrders} ТЗ отдельно` : ""}</TileCaption>
            <dl className="mt-1 space-y-0.5 text-xs">
              {years.filter((y) => y.qty !== 0).map((y) => (
                <div key={y.label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-neutral-600">{y.label}</dt>
                  <dd className="whitespace-nowrap font-medium tabular-nums">{formatQty(y.qty)} шт.<span className="ml-1.5 inline-block w-12 text-right text-[11px] font-normal text-neutral-500">{fact.qty ? `${((y.qty / fact.qty) * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%` : "—"}</span></dd>
                </div>
              ))}
            </dl>
          </button>
          <div className="absolute right-3 top-3">
            <InfoHint label="Что такое «произведено»" wide align="right">
              <p><b>Произведено</b> — изделия по всем ТЗ (завершённые и в работе): учитывается фактическое списание сырья, отметка «Завершён» не важна. Ремонт в штуки не входит — он считается отдельно (страница «Ремонт»). ТЗ без списаний и в плане входят плановым количеством.</p>
              <p className="mt-1">Так же считаются себестоимость, таблица ниже и окно состава.</p>
            </InfoHint>
          </div>
        </div>
        <div className="relative">
          <button type="button" onClick={() => setOpen("all")} aria-haspopup="dialog" aria-label="Себестоимость (факт списания по всем ТЗ) — открыть гистограмму по партиям, годам, категориям и меху" className={TILE_BOX + " w-full text-left shadow-sm transition hover:border-neutral-400 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 print:shadow-none"}>
            <TileHead>Себестоимость</TileHead>
            <TileValue>{money(total)}</TileValue>
            <TileCaption>факт по всем ТЗ: сырьё{c4 === "on" ? " + 4%" : ""} + расходы ТЗ + работа</TileCaption>
            <dl className="mt-1 space-y-0.5 text-xs">
              {parts.map((p) => (
                <div key={p.k} className="flex items-baseline justify-between gap-3">
                  <dt className="text-neutral-600">{p.k}</dt>
                  <dd className="text-right font-medium tabular-nums">
                    {money(p.v)}
                    <span className="ml-1.5 inline-block w-12 text-right text-[11px] font-normal text-neutral-500">{total ? `${((p.v / total) * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%` : "—"}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </button>
          <div className="absolute right-3 top-3">
            <InfoHint label="Что такое себестоимость" wide align="right">
              <p>Вся сумма = мех + подкладка + надбавка 4% (в режиме «С 4%») + расходы ТЗ и прочее + работа. «Себестоимость» без работы: <b>{money(cost(fact))}</b>. Считается по факту списания меха и подкладки во всех ТЗ (завершённых и в работе) — отметка «завершён» не важна.</p>
              <p className="mt-1">Средняя на изделие (без работы) = Σ себестоимость ÷ Σ изделий: <b>{avg != null ? money(avg) : "—"}</b>. Режимы: {vatW}, {c4W}.</p>
            </InfoHint>
          </div>
        </div>
        <AveragesTile search={search} />
      </div>
      </WidgetRow>
      <ProductionTable search={search} />
      {open ? (
        <ProductionModal
          scope={open}
          workTotal={active.work}
          search={search}
          totals={{ costIncl: active.costIncl + (open === "all" ? hides.incl : 0), costExcl: active.costExcl + (open === "all" ? hides.excl : 0), qty: active.qty, orders: active.orders }}
          title={open === "done" ? `Произведено ${formatQty(fact.qty)} шт. на ${money(cost(done))}` : open === "all" ? `Произведено ${formatQty(fact.qty)} шт. · себестоимость ${money(total)}` : `В работе ${formatQty(work.qty)} шт., списано ${money(cost(work))}`}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </section>
  );
}

const mln = (v: number) => formatCompactMoney(v);

/** Мост цифр Производства: состав себестоимости, работа, НДС и связь с блоком «Сырьё» — теперь в «i» у заголовка. */
function ProdBridgeHint({ done, c4, vat, bridge }: { done: ProdNums; c4: "on" | "off"; vat: "incl" | "excl"; bridge: ProdBridge }) {
  const g = (n: ProdNums) => ({ cost: vat === "incl" ? n.costIncl : n.costExcl, mat: vat === "incl" ? n.matIncl : n.matExcl, c4: vat === "incl" ? n.c4Incl : n.c4Excl });
  const D = g(done);
  const rawOther = D.cost - D.mat - D.c4;
  const other = Math.abs(rawOther) < 0.5 ? 0 : rawOther;
  const vatAmount = done.costIncl - done.costExcl;
  return (
    <BridgeHint label="Как сходятся цифры производства" warn={!bridge.comparable}>
      <p><b>Себестоимость (все ТЗ, с ремонтом) {mln(D.cost)} = сырьё (мех + подкладка) {mln(D.mat)} + {c4 === "on" ? <>4%: +{mln(D.c4)}</> : "4%: не начислено"} + расходы ТЗ и прочее {mln(other)}.</b> Работа {mln(done.work)} в себестоимость не входит: сырьё + работа = {mln(D.cost + done.work)}.</p>
      <p className="mt-1">НДС в себестоимости ({vat === "incl" ? "учтён" : "вычтен"}): {mln(vatAmount)} — по ставке лота (20% или 22%). 4% — только на мех и подкладку. Средняя на изделие = Σ себестоимость ÷ Σ изделий (не среднее по ТЗ).</p>
      {bridge.comparable ? (
        <p className="mt-1"><b>Связь с блоком «Сырьё»:</b> использовано сырья {mln(bridge.usedBase[vat])} (без 4%) = сырьё во всех ТЗ {mln(D.mat)} (завершённые и в работе, вместе с ремонтом).</p>
      ) : (
        <p className="mt-1"><b>С блоком «Сырьё» цифры не равны:</b>{" "}
          {bridge.yearOnly ? "«Сырьё» отбирает лоты по году закупки, «Производство» — ТЗ по году ТЗ (сырьё 2025 года могло уйти в ТЗ 2026). " : ""}
          {bridge.lotFilters ? "При фильтре по меху/цвету/НДС/аукциону «Сырьё» показывает только выбранные лоты, а «Производство» — ТЗ целиком, где такой лот списан. " : ""}
          Без фильтров и на «Все годы» они сходятся.</p>
      )}
    </BridgeHint>
  );
}
