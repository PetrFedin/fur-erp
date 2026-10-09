"use client";

import type { ReactNode } from "react";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import type { DrillOrder } from "@/lib/dashboard-drill";
import { sumOrders, sumTotal } from "@/lib/orders-sum";
import { TILE_BOX, TileCaption, TileHead, TileList, TileValue } from "@/app/(app)/dashboard/tile";

const money = (v: number) => formatMoney(v.toFixed(2));

/**
 * Плитки выпуска в формате Главной: «Произведено», «Себестоимость» (с работой и статьями), «На 1 изделие».
 * Считаются из тех же ТЗ, что и дерево под ними и плитки «Производство» на Главной (при тех же фильтрах и годе).
 * `extra` — дополнительные плитки страницы (оплаты партий, склад и т. п.).
 */
export function ProdTiles({ orders, c4, extra, treeId = "orders-tree", extraCount = extra ? 1 : 0 }: { orders: DrillOrder[]; c4: "on" | "off"; extra?: ReactNode; treeId?: string; extraCount?: number }) {
  const { mode: vat } = useVatDisplay();
  const all = sumOrders(orders, vat);
  const own = sumOrders(orders.filter((o) => o.cat !== "Ремонт"), vat);
  const total = sumTotal(all);
  const totalOwn = sumTotal(own);
  const years = new Map<string, number>();
  for (const o of orders) if (o.cat !== "Ремонт") { const k = o.y == null ? "Без года" : String(o.y); years.set(k, (years.get(k) ?? 0) + o.qty); }
  const share = (v: number, t: number) => (t ? v / t : null);
  const link = (href: string) => ({ href, className: TILE_BOX + " w-full text-left shadow-sm transition hover:border-neutral-400 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 print:shadow-none" });
  return (
    <div className={"grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 " + (extraCount >= 2 ? "xl:grid-cols-5" : extraCount === 1 ? "xl:grid-cols-4" : "xl:grid-cols-3")}>
      <div className="relative">
        <a {...link(`#${treeId}`)} aria-label="Произведено — перейти к составу">
          <TileHead>Произведено</TileHead>
          <TileValue>{formatQty(own.qty)} шт.</TileValue>
          <TileCaption>{own.orders} ТЗ · состав ниже →{all.repairOrders > 0 ? ` · ремонт ${all.repairOrders} ТЗ отдельно` : ""}</TileCaption>
          <TileList items={Array.from(years, ([k, q]) => ({ k, v: `${formatQty(q)} шт.`, share: share(q, own.qty) }))} />
        </a>
        <div className="absolute right-3 top-3">
          <InfoHint label="Что такое «произведено»" wide align="right">
            <p><b>Произведено</b> — изделия по всем ТЗ без отменённых и без ремонта: завершённые и в работе (как на Главной). Ремонт считается отдельно (страница «Ремонт»).</p>
          </InfoHint>
        </div>
      </div>
      <div className="relative">
        <a {...link(`#${treeId}`)} aria-label="Себестоимость — перейти к составу">
          <TileHead>Себестоимость</TileHead>
          <TileValue>{money(total)}</TileValue>
          <TileCaption>сырьё{c4 === "on" ? " + 4%" : ""} + расходы ТЗ + работа{all.repairOrders > 0 ? ` · без ремонта ${money(totalOwn)}` : ""}</TileCaption>
          <TileList items={[
            { k: "Мех", v: money(all.fur), share: share(all.fur, total) },
            { k: "Подкладка", v: money(all.lining), share: share(all.lining, total) },
            ...(c4 === "on" ? [{ k: "Надбавка 4%", v: money(all.c4), share: share(all.c4, total) }] : []),
            ...(Math.abs(all.other) > 0.5 ? [{ k: "Расходы ТЗ и прочее", v: money(all.other), share: share(all.other, total) }] : []),
            { k: "Работа", v: money(all.work), share: share(all.work, total) },
          ]} />
        </a>
        <div className="absolute right-3 top-3">
          <InfoHint label="Что такое себестоимость" wide align="right">
            <p>Мех (с шкурами подрядчика) + подкладка + 4% (в режиме «С 4%») + расходы ТЗ и прочее + работа. Это та же «Себестоимость», что в блоке «Производство» на Главной; в неё входит ремонт. Режимы шапки: {vat === "incl" ? "с НДС" : "без НДС"}, {c4 === "on" ? "с 4%" : "без 4%"}.</p>
          </InfoHint>
        </div>
      </div>
      <div className="relative">
        <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
          <TileHead>На 1 изделие</TileHead>
          <TileValue>{own.qty > 0 ? money(totalOwn / own.qty) : "—"}</TileValue>
          <TileCaption>{own.qty > 0 ? "себестоимость с работой ÷ произведено, без ремонта" : "изделий нет"}</TileCaption>
          {own.qty > 0 ? (
            <TileList items={[
              { k: "Сырьё (мех + подкладка)", v: money((own.fur + own.lining) / own.qty), share: share(own.fur + own.lining, totalOwn) },
              ...(c4 === "on" ? [{ k: "Надбавка 4%", v: money(own.c4 / own.qty), share: share(own.c4, totalOwn) }] : []),
              ...(Math.abs(own.other) > 0.5 ? [{ k: "Расходы ТЗ и прочее", v: money(own.other / own.qty), share: share(own.other, totalOwn) }] : []),
              { k: "Работа", v: money(own.work / own.qty), share: share(own.work, totalOwn) },
            ]} />
          ) : null}
        </div>
        <div className="absolute right-3 top-3">
          <InfoHint label="Как считается на изделие" wide align="right">
            <p>Σ себестоимость без ремонта ({money(totalOwn)}) ÷ Σ изделий ({formatQty(own.qty)} шт.). Не среднее по ТЗ, а общая сумма на общее количество.</p>
          </InfoHint>
        </div>
      </div>
      {extra}
    </div>
  );
}
