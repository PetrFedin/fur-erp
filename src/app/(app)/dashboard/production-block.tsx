"use client";

import { useMemo, useState } from "react";
import { useSeasonScope } from "./season-scope";
import { isRepair, sumOrders } from "@/lib/orders-sum";
import { seasonRank } from "@/lib/sales-section";
import Link from "next/link";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty, formatShare } from "@/lib/utils";
import { ProductionModal } from "./production-modal";
import { ProductionTable } from "./production-table";
import { AveragesTable } from "./averages-table";
import { AveragesTile, useDrill } from "./averages";
import { TileCarousel } from "@/components/tile-carousel";
import { GroupCostSlide, GroupProducedSlide, PROD_GROUPS } from "@/components/prod-group-slides";
import { WidgetRow } from "@/components/widget-row";
import { InfoHint } from "@/components/info-hint";
import { SEG_GROUP, segCls } from "@/components/segmented";
import { withVolume, type DrillOrder, type VolumeMode } from "@/lib/dashboard-drill";
import { TileCaption, TileValue } from "./tile";
import { BridgeHint, type ModeInfo } from "./mode-line";
import { formatCompactMoney } from "./compact";
import { VatLine, vatEntries } from "./vat-line";
import type { VatByRate } from "@/lib/dashboard-data";
import { COST_FULL_LABEL, OUTPUT_LABEL } from "@/lib/cost-labels";

export type ProdNums = { items: number; repairOrders: number; repairQty: number; repairCostIncl: number; repairCostExcl: number; orders: number; qty: number; costIncl: number; costExcl: number; work: number; furIncl: number; furExcl: number; liningIncl: number; liningExcl: number; matIncl: number; matExcl: number; c4Incl: number; c4Excl: number };
export type ProdBridge = { usedBase: { incl: number; excl: number }; comparable: boolean; lotFilters: boolean; yearOnly: boolean };

const addNums = (a: ProdNums, b: ProdNums): ProdNums => ({ items: a.items + b.items, repairOrders: a.repairOrders + b.repairOrders, repairQty: a.repairQty + b.repairQty, repairCostIncl: a.repairCostIncl + b.repairCostIncl, repairCostExcl: a.repairCostExcl + b.repairCostExcl, orders: a.orders + b.orders, qty: a.qty + b.qty, costIncl: a.costIncl + b.costIncl, costExcl: a.costExcl + b.costExcl, work: a.work + b.work, furIncl: a.furIncl + b.furIncl, furExcl: a.furExcl + b.furExcl, liningIncl: a.liningIncl + b.liningIncl, liningExcl: a.liningExcl + b.liningExcl, matIncl: a.matIncl + b.matIncl, matExcl: a.matExcl + b.matExcl, c4Incl: a.c4Incl + b.c4Incl, c4Excl: a.c4Excl + b.c4Excl });

type VatPair = { incl: number; excl: number };

/** Годы — по году прихода (а не по дате ТЗ): в сезоне, начавшемся в 2026, не бывает «2025»; FW 25/26 делится на пришедшее в 2025 и в 2026. На «Все» — по всем сезонам. */
function yearsOf(orders: DrillOrder[], season: string): { label: string; qty: number }[] {
  const ys = new Map<string, number>();
  for (const o of orders) {
    const base = o.orig ?? o;
    const inSeason = Object.entries(base.swy ?? {}).filter(([k]) => season === "all" || k.split("|")[0] === season), tot = inSeason.reduce((a, [, v]) => a + v, 0);
    if (tot > 0) { for (const [k, share] of inSeason) { const yy = k.split("|")[1]; ys.set(yy, (ys.get(yy) ?? 0) + o.qty * (share / tot)); } }
    else { const k = o.y != null ? String(o.y) : "2026"; ys.set(k, (ys.get(k) ?? 0) + o.qty); }
  }
  return Array.from(ys).sort((a, b) => a[0].localeCompare(b[0])).map(([label, qty]) => ({ label, qty }));
}

/** «Произведено» по сезонам прихода: Σ qd × доля сезона; штуки без ТЗ — в открытый сезон. grp — только группа категорий (или все). */
function producedSeasons(orders: DrillOrder[], grp?: string): { label: string; qty: number }[] {
  const m = new Map<string, number>();
  for (const o of orders) {
    if (isRepair(o) || (grp && o.grp !== grp)) continue;
    if (o.id.startsWith("no-tz")) { m.set("FW 26/27", (m.get("FW 26/27") ?? 0) + (o.qd ?? 0)); continue; }
    for (const [k, w] of Object.entries(o.swd ?? {})) m.set(k, (m.get(k) ?? 0) + (o.qd ?? 0) * w);
  }
  return Array.from(m).sort((a, b) => seasonRank(a[0]) - seasonRank(b[0])).map(([label, qty]) => ({ label, qty: Math.round(qty) }));
}

export function ProductionBlock({ href = "/production", vatCost: vatCostP, kind = "", hides: hidesP, c4Parts: c4PartsP, years: yearsP, done: doneP, work: workP, all: allP, c4, search, info, bridge }: { /** «→ ТЗ» с фильтрами Главной. */ href?: string; hides: VatPair; vatCost: VatByRate; kind?: string; c4Parts: { fur: VatPair; lining: VatPair }; years: { label: string; qty: number }[]; done: ProdNums; work: ProdNums; /** Все ТЗ (уникальные номера ТЗ по всему набору, а не сумма двух частей). */ all: ProdNums; c4: "on" | "off"; search: Record<string, string[]>; info: ModeInfo; bridge: ProdBridge }) {
  const { mode: vat } = useVatDisplay();
  const [open, setOpen] = useState<null | "done" | "work" | "all">(null);
  // Всего / Одежда / Аксессуары листаются вместе во всех плитках блока.
  const [grpIdx, setGrpIdx] = useState(0);
  // Блок показывает произведённое (= получено по приходу); «В выпуске» — заказ по сезонам (закрытые: заказ = приход, открытый: заказ больше прихода).
  const volume: VolumeMode = "produced";
  const grpSync = { index: grpIdx, onChange: setGrpIdx };
  const { data: drill } = useDrill(search);
  const vdrill = useMemo(() => withVolume(drill, "produced"), [drill]);
  const drillOrders = vdrill?.orders ?? [];
  // Сезон из панели «Сезон» Главной: плитки считаются от ТЗ выбранного сезона (доли ТЗ по приходу модели, см. order-seasons.ts); «Все» — готовые числа страницы.
  const season = useSeasonScope()?.season ?? "all";
  const sn = useMemo(() => {
    if (!vdrill) return null;
    const own = vdrill.orders.filter((o) => !isRepair(o));
    const I = sumOrders(own, "incl"), E = sumOrders(own, "excl");
    const nums: ProdNums = { items: I.items, repairOrders: 0, repairQty: 0, repairCostIncl: 0, repairCostExcl: 0, orders: I.orders, qty: I.qty, costIncl: I.fur + I.lining + I.c4 + I.other, costExcl: E.fur + E.lining + E.c4 + E.other, work: I.work, furIncl: I.fur, furExcl: E.fur, liningIncl: I.lining, liningExcl: E.lining, matIncl: I.fur + I.lining, matExcl: E.fur + E.lining, c4Incl: I.c4, c4Excl: E.c4 };
    return { nums, years: yearsOf(own, season) };
  }, [season, vdrill]);
  const ZERO: ProdNums = { items: 0, repairOrders: 0, repairQty: 0, repairCostIncl: 0, repairCostExcl: 0, orders: 0, qty: 0, costIncl: 0, costExcl: 0, work: 0, furIncl: 0, furExcl: 0, liningIncl: 0, liningExcl: 0, matIncl: 0, matExcl: 0, c4Incl: 0, c4Excl: 0 };
  // На «Все» в плитке «В выпуске» — разбивка по сезонам (доли ТЗ по приходу модели), а не по годам ТЗ; пока ТЗ не загрузились — годы страницы.
  const seasonQty = useMemo(() => {
    if (season !== "all" || !drill) return null;
    // Заказ по сезонам (объём ТЗ) и «пришло» (получено по приходу): закрытые сезоны — заказ = приход, открытый — заказ больше прихода на «ещё придёт».
    const m = new Map<string, number>(), got = new Map<string, number>();
    for (const o of drill.orders) {
      if (isRepair(o) || o.id.startsWith("no-tz")) continue;
      for (const [k, w] of Object.entries(o.sw ?? {})) m.set(k, (m.get(k) ?? 0) + o.qty * w);
      for (const [k, w] of Object.entries(o.swd ?? {})) got.set(k, (got.get(k) ?? 0) + (o.qd ?? 0) * w);
    }
    for (const o of drill.orders) if (o.id.startsWith("no-tz")) got.set("FW 26/27", (got.get("FW 26/27") ?? 0) + (o.qd ?? 0));
    return Array.from(m).sort((a, b) => seasonRank(a[0]) - seasonRank(b[0])).map(([label, qty]) => ({ label, qty, got: Math.round(got.get(label) ?? 0) }));
  }, [season, drill]);
  const done = sn ? sn.nums : doneP, work = sn ? ZERO : workP, all = sn ? sn.nums : allP;
  const hides = sn ? { incl: 0, excl: 0 } : hidesP, c4Parts = sn ? { fur: { incl: 0, excl: 0 }, lining: { incl: 0, excl: 0 } } : c4PartsP, vatCost: VatByRate = sn ? {} : vatCostP;
  // «В выпуске» — заказ: на «Все» по сезонам (закрытые: заказ = приход; открытый FW 26/27: заказ и % пришло), в сезоне — по годам прихода.
  const ordOwn = useMemo(() => (drill ? drill.orders.filter((o) => !isRepair(o) && !o.id.startsWith("no-tz")) : []), [drill]);
  const ordQty = drill ? ordOwn.reduce((a, o) => a + o.qty, 0) : allP.qty;
  const ordOrders = drill ? ordOwn.filter((o) => o.qty > 0).length : allP.orders;
  const ordYears = drill ? (season === "all" && seasonQty && seasonQty.length > 0 ? seasonQty : yearsOf(ordOwn, season)) : yearsP;
  // «Произведено» — получено по приходу: на «Все» по сезонам прихода, в сезоне — по годам прихода.
  const prodSeasons = useMemo(() => (drill && season === "all" ? producedSeasons(drill.orders) : null), [season, drill]);
  // Разбивка строк «Произведено» на одежду и аксессуары: по сезонам (на «Все») или по годам прихода (в сезоне).
  const prodByGrp = useMemo(() => {
    if (!drill || !vdrill) return null;
    const rows = (g: string) => (season === "all" ? producedSeasons(drill.orders, g) : yearsOf(vdrill.orders.filter((o) => !isRepair(o) && o.grp === g), season).map((y) => ({ label: y.label, qty: Math.round(y.qty) })));
    const clothes = rows("Одежда"), acc = rows("Аксессуары");
    const q = (l: { label: string; qty: number }[]) => l.reduce((a, x) => a + x.qty, 0);
    return { clothes, acc, clothesQty: q(clothes), accQty: q(acc) };
  }, [season, drill, vdrill]);
  const prodYears = prodSeasons && prodSeasons.length > 0 ? prodSeasons : sn ? sn.years : yearsP;
  // Себестоимость — факт списания по всем ТЗ.
  const fact = { ...addNums(done, work), orders: all.orders, items: all.items, repairOrders: all.repairOrders };
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
    // Расходы ТЗ и прочее отдельной строкой не показываем: это поправки к стоимости сырья по документам ТЗ (НДС 22 % вместо 20 % в лотах) и доп. материалы — входят в мех.
    { k: "Мех", v: D.fur + other, with4: D.fur + other + c4Parts.fur[vat] },
    { k: "Подкладка", v: D.lining, with4: D.lining + c4Parts.lining[vat] },
    ...(c4 === "on" ? [{ k: "Надбавка 4%", v: D.c4, with4: undefined as number | undefined }] : []),
    { k: "Работа", v: fact.work, with4: undefined as number | undefined },
  ];
  void info;
  const vatW = vat === "incl" ? "с НДС" : "без НДС";
  const c4W = c4 === "on" ? "с 4%" : "без 4%";
  const money = (v: number) => formatMoney(v.toFixed(2));
  const active = open === "work" ? work : open === "all" ? fact : done;

  const outputTile = (t: { title: string; hintLabel: string; hint: import("react").ReactNode; qty: number; orders: number; years: { label: string; qty: number; got?: number }[]; orders2: DrillOrder[]; got: boolean; split?: { clothes: { label: string; qty: number }[]; acc: { label: string; qty: number }[]; clothesQty: number; accQty: number } | null }) => (
    <TileCarousel sync={grpSync} clickable hoverBlocks title={t.title} hintLabel={t.hintLabel} slidesLabel="слайды: всего, одежда, аксессуары" dotsLabel="Группа" hint={t.hint}
      slides={[
        { key: "total", label: "Всего", body: (
          <button type="button" onClick={() => setOpen("all")} aria-haspopup="dialog" aria-label={`${t.title} — открыть себестоимость по статьям`} className={SLIDE_BTN}>
            <TileValue>{formatQty(t.qty)} шт.</TileValue>
            <TileCaption>{`${t.orders} ТЗ`}</TileCaption>
            <dl className="mt-1 space-y-0.5 text-xs">
              {t.years.filter((y) => y.qty !== 0).map((y) => {
                // «В выпуске» по сезонам: слева — какая часть заказа пришла; иначе — доля от всего.
                const g = t.got ? y.got : undefined;
                const left = g !== undefined ? (y.qty > 0 ? `${Math.round((g / y.qty) * 100)} % пришло` : "–") : t.qty ? formatShare(y.qty / t.qty) : "–";
                const c = t.split?.clothes.find((x) => x.label === y.label)?.qty, a2 = t.split?.acc.find((x) => x.label === y.label)?.qty;
                return (
                  <div key={y.label}>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-neutral-600">{y.label}</dt>
                      <dd className="whitespace-nowrap font-medium tabular-nums"><span className="mr-1.5 inline-block min-w-12 text-right text-[11px] font-normal text-neutral-500">{left}</span>{formatQty(y.qty)} шт.</dd>
                    </div>
                    {t.split ? <div className="text-right text-[11px] tabular-nums text-neutral-500">одежда {formatQty(c ?? 0)} · аксессуары {formatQty(a2 ?? 0)}</div> : null}
                  </div>
                );
              })}
              {t.split ? <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-neutral-200 pt-1"><dt className="text-neutral-600">Всего</dt><dd className="whitespace-nowrap text-[11px] tabular-nums text-neutral-700">одежда <b>{formatQty(t.split.clothesQty)}</b> · аксессуары <b>{formatQty(t.split.accQty)}</b></dd></div> : null}
            </dl>
          </button>) },
        ...PROD_GROUPS.map((g) => ({ key: g, label: g, body: (
          <button type="button" onClick={() => setOpen("all")} aria-haspopup="dialog" aria-label={`${t.title}: ${g} — открыть состав`} className={SLIDE_BTN}>
            <GroupProducedSlide all={t.orders2} grp={g} vat={vat} loading={!drill} compact />
          </button>) })),
      ]} />
  );

  return (
    <section aria-label="Производство" className="space-y-2">
      <WidgetRow id="prod" title="Производство"
        headerExtra={<ProdBridgeHint done={fact} c4={c4} vat={vat} bridge={bridge} vatCost={vatCost} />}
        headerEnd={<Link href={href} className="text-xs text-blue-700 hover:underline print:hidden">→ ТЗ</Link>}>
      <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-2 xl:grid-cols-4 print:grid-cols-4">
        {outputTile({ title: OUTPUT_LABEL, hintLabel: "Что такое «в выпуске»", hint: <><p><b>{OUTPUT_LABEL}</b> — заказ: изделия по ТЗ. Закрытые сезоны (FW 25/26, SS 2026): заказ = приход. Открытый сезон (FW 26/27): заказ больше прихода на то, что ещё придёт; справа от сезона — какая часть заказа уже пришла.</p><p className="mt-1">Ремонт в штуки не входит (страница «Ремонт»). «Одежда» и «Аксессуары» дают «Всего».</p></>, qty: ordQty, orders: ordOrders, years: ordYears, orders2: drill?.orders ?? [], got: true })}
        {outputTile({ title: "Произведено", hintLabel: "Что такое «произведено»", hint: <><p><b>Произведено</b> — то, что получено по файлу прихода (MVST РМ), раскладывается на ТЗ модели. Стоимость и среднее на изделие справа считаются по произведённому.</p><p className="mt-1">Сезоны и годы — по сезону и году прихода. Внутри плиток можно переключать «Все» и сезоны на панели «Сезон».</p></>, qty: all.qty, orders: all.orders, years: prodYears, orders2: drillOrders, got: false, split: prodByGrp })}
        <TileCarousel sync={grpSync} clickable hoverBlocks title={`${COST_FULL_LABEL} произведённого`} hintLabel="Что такое полная себестоимость" slidesLabel="слайды: всего, одежда, аксессуары" dotsLabel="Группа"
          hint={<>
            <p>Факт по всем ТЗ: мех + подкладка{c4 === "on" ? " + 4%" : ""} + расходы ТЗ + работа. Без работы — «Себестоимость сырья»: <b>{money(cost(fact))}</b>.</p>
            <p className="mt-1">Средняя на изделие (без работы) = Σ себестоимость ÷ Σ изделий: <b>{avg != null ? money(avg) : "–"}</b>. Режимы: {vatW}, {c4W}.</p>
            <p className="mt-1">«Всего» включает ремонт; «Одежда» и «Аксессуары» — только изделия группы.</p>
          </>}
          slides={[
            { key: "total", label: "Всего", body: (
              <button type="button" onClick={() => setOpen("all")} aria-haspopup="dialog" aria-label="Полная себестоимость (факт списания по всем ТЗ) — открыть гистограмму по партиям, годам, категориям и меху" className={SLIDE_BTN}>
                <TileValue>{money(total)}</TileValue>
                <div className="min-h-4 text-[11px] leading-4 tabular-nums text-neutral-600">{c4 === "on" ? `${money(total - D.c4)} без 4%` : null}</div>
                <TileCaption>{null}</TileCaption>
                <dl className="mt-1 space-y-0.5 text-xs">
                  {parts.map((p) => (
                    <div key={p.k} className="flex items-baseline justify-between gap-3">
                      <dt className="text-neutral-600">{p.k}</dt>
                      <dd className="text-right font-medium tabular-nums">
                        {Math.abs(p.v) < 0.5 ? "\u00a0" : (
                          <>
                            <span className="mr-1.5 inline-block w-12 text-right text-[11px] font-normal text-neutral-500">{total ? formatShare(p.v / total) : "–"}</span>
                            {money(p.v)}
                          </>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
                <VatLine v={vatCost} />
              </button>) },
            ...PROD_GROUPS.map((g) => ({ key: g, label: g, body: (
              <button type="button" onClick={() => setOpen("all")} aria-haspopup="dialog" aria-label={`Полная себестоимость: ${g} — открыть состав`} className={SLIDE_BTN}>
                <GroupCostSlide all={drillOrders} grp={g} vat={vat} c4={c4} loading={!drill} compact />
              </button>) })),
          ]} />
        <AveragesTile data={vdrill} sync={{ index: Math.max(0, grpIdx - 1), onChange: (i) => setGrpIdx(i + 1) }} />
      </div>
      </WidgetRow>
      <ProductionTable search={search} volume="produced" />
      <AveragesTable data={drill} volume="produced" />
      {open ? (
        <ProductionModal
          scope={open}
          workTotal={active.work}
          search={search}
          totals={{ costIncl: active.costIncl + (open === "all" ? hides.incl : 0), costExcl: active.costExcl + (open === "all" ? hides.excl : 0), qty: active.qty, orders: active.orders }}
          title={open === "done" ? `В выпуске ${formatQty(fact.qty)} шт.` : open === "all" ? `В выпуске ${formatQty(fact.qty)} шт. · полная себестоимость ${money(total)}` : `В выпуске ${formatQty(work.qty)} шт.`}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </section>
  );
}

const SLIDE_BTN = "block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700";
const mln = (v: number) => formatCompactMoney(v);

/** Мост цифр Производства: состав себестоимости, работа, НДС и связь с блоком «Сырьё» — теперь в «i» у заголовка. */
function ProdBridgeHint({ done, c4, vat, bridge, vatCost }: { vatCost: VatByRate; done: ProdNums; c4: "on" | "off"; vat: "incl" | "excl"; bridge: ProdBridge }) {
  const g = (n: ProdNums) => ({ cost: vat === "incl" ? n.costIncl : n.costExcl, mat: vat === "incl" ? n.matIncl : n.matExcl, c4: vat === "incl" ? n.c4Incl : n.c4Excl });
  const D = g(done);
  const rawOther = D.cost - D.mat - D.c4;
  const other = Math.abs(rawOther) < 0.5 ? 0 : rawOther;
  const vatAmount = done.costIncl - done.costExcl;
  return (
    <BridgeHint label="Как сходятся цифры производства" warn={!bridge.comparable}>
      <p><b>Себестоимость сырья (все ТЗ, с ремонтом) {mln(D.cost)} = мех + подкладка {mln(D.mat)} + {c4 === "on" ? <>4%: {mln(D.c4)}</> : "4%: не начислено"} + расходы ТЗ и прочее {mln(other)}.</b> Работа {mln(done.work)} сюда не входит: полная себестоимость = сырьё + работа = {mln(D.cost + done.work)}.</p>
      <p className="mt-1">НДС в себестоимости ({vat === "incl" ? "учтён" : "вычтен"}): {mln(vatAmount)}, по ставке лота (20% или 22%){vatEntries(vatCost).length ? <>; без 4%: {vatEntries(vatCost).map(([r, x]) => `${r}% — ${mln(x)}`).join(" · ")}</> : null}. 4% — только на мех и подкладку.</p>
      {bridge.comparable ? (
        <p className="mt-1"><b>С блоком «Сырьё» сходится:</b> использовано {mln(bridge.usedBase[vat])} (без 4%) = мех и подкладка во всех ТЗ {mln(D.mat)}.</p>
      ) : (
        <p className="mt-1"><b>С блоком «Сырьё» не равно:</b>{" "}
          {bridge.yearOnly ? "«Сырьё» отбирает лоты по году закупки, «Производство» — ТЗ по году ТЗ. " : ""}
          {bridge.lotFilters ? "При фильтре по меху, цвету, НДС или аукциону «Сырьё» показывает выбранные лоты, а «Производство» — ТЗ целиком. " : ""}
          Без фильтров и на «Все годы» цифры сходятся.</p>
      )}
    </BridgeHint>
  );
}
