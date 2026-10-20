"use client";

import { Fragment, type ReactNode } from "react";
import { tzCountText } from "@/lib/tz-key";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import type { DrillOrder } from "@/lib/dashboard-drill";
import { showTotals } from "@/lib/orders-sum";
import { COST_FULL_LABEL, OUTPUT_LABEL } from "@/lib/cost-labels";
import { TileCarousel } from "@/components/tile-carousel";
import { GroupCostSlide, GroupProducedSlide, PROD_GROUPS } from "@/components/prod-group-slides";
import { WidgetRow } from "@/components/widget-row";
import { TILE_BOX, TileCaption, TileHead, TileList, TileValue } from "@/app/(app)/dashboard/tile";

const money = (v: number) => formatMoney(v.toFixed(2));

/**
 * Плитки выпуска в формате Главной: «Произведено», «Себестоимость» (с работой и статьями), «На 1 изделие».
 * Считаются из тех же ТЗ, что и дерево под ними и плитки «Производство» на Главной (при тех же фильтрах и годе).
 * `extra` — дополнительные плитки страницы (оплаты партий, маркап и т. п.); `perUnit` — замена плитки «На 1 изделие» (карусель на «Изделиях»).
 */
export function ProdTiles({ orders, c4, extra, treeId = "orders-tree", extraCount = extra ? 1 : 0, id = "prod", title = "Производство", perUnit, carousel = false, headerEnd, hideProduced = false, hidePerUnit = false, defaultCollapsed = false }: { /** Свёрнуто, пока человек сам не развернул (итоги дублируют раздел «ТЗ»). */ defaultCollapsed?: boolean; hideProduced?: boolean; hidePerUnit?: boolean; headerEnd?: ReactNode; carousel?: boolean; id?: string; perUnit?: ReactNode; title?: string; orders: DrillOrder[]; c4: "on" | "off"; extra?: ReactNode; treeId?: string; extraCount?: number }) {
  const { mode: vat } = useVatDisplay();
  const { all, own, total, totalOwn, repair } = showTotals(orders, vat);
  const years = new Map<string, number>();
  for (const o of orders) if (o.cat !== "Ремонт") { const k = o.y == null ? "Без года" : String(o.y); years.set(k, (years.get(k) ?? 0) + o.qty); }
  const share = (v: number, t: number) => (t && Math.abs(v) > 0.005 ? v / t : null);
  const link = (href: string) => ({ href, "data-hover-block": "prod", className: TILE_BOX + " w-full text-left shadow-sm tile-click focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 print:shadow-none" });
  const slideLink = "block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700";
  const producedTotal = (
    <>
      <TileValue>{formatQty(own.qty)} шт.</TileValue>
      <TileCaption>{tzCountText(own.orders, own.items)}{all.repairOrders > 0 ? ` · ремонт ${all.repairOrders} ТЗ отдельно` : ""}</TileCaption>
      <TileList items={Array.from(years, ([k, q]) => ({ k, v: `${formatQty(q)} шт.`, share: share(q, own.qty) }))} />
    </>
  );
  const costTotal = (
    <>
      <TileValue>{money(total)}</TileValue>
      {carousel ? <div className="min-h-4 text-[11px] leading-4 tabular-nums text-neutral-400">{c4 === "on" ? `${money(total - all.c4)} без 4 %` : null}</div> : null}
      <TileCaption>сырьё{c4 === "on" ? " + 4 %" : ""} + расходы ТЗ + работа{all.repairOrders > 0 ? ` · в том числе ремонт ${money(repair)}` : ""}</TileCaption>
      <TileList items={[
        { k: "Мех", v: money(all.fur), share: share(all.fur, total) },
        { k: "Подкладка", v: money(all.lining), share: share(all.lining, total) },
        ...(c4 === "on" ? [{ k: "Надбавка 4 %", v: money(all.c4), share: share(all.c4, total) }] : []),
        ...(Math.abs(all.other) > 0.5 && Math.abs(all.other) >= total * 0.001 ? [{ k: "Расходы ТЗ и прочее", v: money(all.other), share: share(all.other, total) }] : []),
        { k: "Работа", v: money(all.work), share: share(all.work, total) },
      ]} />
    </>
  );
  return (
    <WidgetRow id={id} title={title} headerEnd={headerEnd} defaultCollapsed={defaultCollapsed}>
    <div className={"grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 " + (["xl:grid-cols-1", "xl:grid-cols-2", "xl:grid-cols-3", "xl:grid-cols-4", "xl:grid-cols-5"][Math.min(4, (hideProduced ? 0 : 1) + 1 + (hidePerUnit ? 0 : 1) + extraCount - 1)])}>
      {hideProduced ? null : carousel ? (
        <TileCarousel clickable hoverBlocks title={OUTPUT_LABEL} hintLabel="Что такое «в выпуске»" slidesLabel="слайды: всего, одежда, аксессуары" dotsLabel="Группа"
          hint={<><p><b>{OUTPUT_LABEL}</b> — изделия по всем ТЗ без отменённых и без ремонта. «Всего» — все изделия страницы; «Одежда» и «Аксессуары» — то же по группе категорий (в сумме дают «Всего» без ремонта). Ремонт — только в «Всего» и отдельной страницей.</p><p className="mt-1">Листайте вправо-влево, стрелками ‹ › (или клавишами ← →) или точками.</p></>}
          slides={[
            { key: "total", label: "Всего", body: <a href={`#${treeId}`} className={slideLink} aria-label="В выпуске — перейти к составу">{producedTotal}</a> },
            ...PROD_GROUPS.map((g) => ({ key: g, label: g, body: <a href={`#${treeId}`} className={slideLink} aria-label={`В выпуске: ${g} — перейти к составу`}><GroupProducedSlide all={orders} grp={g} vat={vat} link /></a> })),
          ]} />
      ) : (
      <div className="relative">
        <a {...link(`#${treeId}`)} aria-label="В выпуске — перейти к составу">
          <TileHead>{OUTPUT_LABEL}</TileHead>
          {producedTotal}
        </a>
        <div className="absolute right-3 top-3">
          <InfoHint label="Что такое «в выпуске»" wide align="right">
            <p><b>{OUTPUT_LABEL}</b> — изделия по всем ТЗ без отменённых и без ремонта (как на Главной). Ремонт считается отдельно (страница «Ремонт»).</p>
          </InfoHint>
        </div>
      </div>
      )}
      {carousel ? (
        <TileCarousel clickable hoverBlocks title={COST_FULL_LABEL} hintLabel="Что такое полная себестоимость" slidesLabel="слайды: всего, одежда, аксессуары" dotsLabel="Группа"
          hint={<><p>Мех (с шкурами подрядчика) + подкладка + 4 % (в режиме «С 4 %») + расходы ТЗ и прочее + работа. «Всего» включает ремонт (его сумма — в подписи под цифрой); «Одежда» и «Аксессуары» — только изделия группы, в сумме дают «Всего» без ремонта. Режимы шапки: {vat === "incl" ? "с НДС" : "без НДС"}, {c4 === "on" ? "с 4 % (мелко — без 4 %)" : "без 4 %"}.</p><p className="mt-1">Листайте вправо-влево, стрелками ‹ › (или клавишами ← →) или точками.</p></>}
          slides={[
            { key: "total", label: "Всего", body: <a href={`#${treeId}`} className={slideLink} aria-label="Полная себестоимость — перейти к составу">{costTotal}</a> },
            ...PROD_GROUPS.map((g) => ({ key: g, label: g, body: <a href={`#${treeId}`} className={slideLink} aria-label={`Полная себестоимость: ${g} — перейти к составу`}><GroupCostSlide all={orders} grp={g} vat={vat} c4={c4} /></a> })),
          ]} />
      ) : (
      <div className="relative">
        <a {...link(`#${treeId}`)} aria-label="Полная себестоимость — перейти к составу">
          <TileHead>{COST_FULL_LABEL}</TileHead>
          {costTotal}
        </a>
        <div className="absolute right-3 top-3">
          <InfoHint label="Что такое себестоимость" wide align="right">
            <p>Мех (с шкурами подрядчика) + подкладка + 4 % (в режиме «С 4 %») + расходы ТЗ и прочее + работа. Это та же «Полная себестоимость (с работой)», что в блоке «Производство» на Главной; без работы она называется «Себестоимость сырья» (таблица партий, «Аналитика → Изделия»); в неё входит ремонт (отдельной строкой «из них ремонт»). Режимы шапки: {vat === "incl" ? "с НДС" : "без НДС"}, {c4 === "on" ? "с 4 %" : "без 4 %"}.</p>
          </InfoHint>
        </div>
      </div>
      )}
      {hidePerUnit ? null : perUnit ?? <div className="relative">
        <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
          <TileHead>На 1 изделие</TileHead>
          <TileValue>{own.qty > 0 ? money(totalOwn / own.qty) : "—"}</TileValue>
          <TileCaption>{own.qty > 0 ? "полная себестоимость ÷ в выпуске, без ремонта" : "изделий нет"}</TileCaption>
          {own.qty > 0 ? (
            <TileList items={[
              { k: "Сырьё (мех + подкладка)", v: money((own.fur + own.lining) / own.qty), share: share(own.fur + own.lining, totalOwn) },
              ...(c4 === "on" ? [{ k: "Надбавка 4 %", v: money(own.c4 / own.qty), share: share(own.c4, totalOwn) }] : []),
              ...(Math.abs(own.other) > 0.5 && Math.abs(own.other) >= totalOwn * 0.001 ? [{ k: "Расходы ТЗ и прочее", v: money(own.other / own.qty), share: share(own.other, totalOwn) }] : []),
              { k: "Работа (начислено ÷ в выпуске)", v: money(own.work / own.qty), share: share(own.work, totalOwn) },
            ]} />
          ) : null}
        </div>
        <div className="absolute right-3 top-3">
          <InfoHint label="Как считается на изделие" wide align="right">
            <p>Σ себестоимость без ремонта ({money(totalOwn)}) ÷ Σ изделий ({formatQty(own.qty)} шт.). Не среднее по ТЗ, а общая сумма на общее количество.</p>
          </InfoHint>
        </div>
      </div>}
      {extra ? <Fragment key="extra">{extra}</Fragment> : null}
    </div>
    </WidgetRow>
  );
}
