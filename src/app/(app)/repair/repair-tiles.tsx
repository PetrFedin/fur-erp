"use client";

import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import type { DrillOrder } from "@/lib/dashboard-drill";
import { sumOrders, sumTotal } from "@/lib/orders-sum";
import Link from "next/link";
import { WidgetRow } from "@/components/widget-row";
import { TotalLabel } from "@/components/total-label";
import { TILE_BOX, TileCaption, TileHead, TileList, TileValue } from "../dashboard/tile";

const money = (v: number) => formatMoney(v.toFixed(2));

/** Плитки ремонта в формате Главной: сколько ТЗ и штук, и из чего состоит себестоимость ремонта. */
export function RepairTiles({ orders, c4, filtered = false }: { orders: DrillOrder[]; c4: "on" | "off"; filtered?: boolean }) {
  const { mode: vat } = useVatDisplay();
  const s = sumOrders(orders, vat);
  const total = sumTotal(s);
  const share = (v: number) => (total ? v / total : null);
  return (
    <WidgetRow id="repair" title={filtered ? "Ремонт — по фильтрам" : "Ремонт"} headerEnd={<Link href="/production" className="text-xs text-blue-700 hover:underline print:hidden">→ ТЗ</Link>}>
    <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-2">
      <div className="relative">
      <a href="#orders-tree" aria-label="Ремонт — перейти к составу ТЗ" className={TILE_BOX + " w-full shadow-sm tile-click print:shadow-none"}>
        <TileHead>Ремонт</TileHead>
        <TileValue>{s.repairOrders} ТЗ</TileValue>
        <TileCaption>{formatQty(s.repairQty)} шт.</TileCaption>
        <TileList items={[{ k: "Штук", v: formatQty(s.repairQty) }, { k: "Работа на штуку", v: s.repairQty > 0 ? money(s.work / s.repairQty) : "—" }]} />
      </a>
        <div className="absolute right-3 top-3">
          <InfoHint label="Что такое ремонт" wide align="right">
            <p>ТЗ на ремонт не входят в «В выпуске» и в средние цены изделий. Их затраты остаются в общей себестоимости на Главной («Всего с ремонтом»).</p>
          </InfoHint>
        </div>
      </div>
      <div className="relative">
      <a href="#orders-tree" aria-label="Полная себестоимость ремонта — перейти к составу ТЗ" className={TILE_BOX + " w-full shadow-sm tile-click print:shadow-none"}>
        <TileHead>Полная себестоимость ремонта</TileHead>
        <TileValue>{money(total)}</TileValue>
        <TileCaption>сырьё{c4 === "on" ? " + 4 %" : ""} + расходы ТЗ + работа</TileCaption>
        <TileList items={[
          { k: "Материалы: мех", v: money(s.fur), share: share(s.fur) },
          ...(Math.abs(s.lining) > 0.5 ? [{ k: "Материалы: подкладка", v: money(s.lining), share: share(s.lining) }] : []),
          ...(c4 === "on" ? [{ k: "Надбавка 4 %", v: money(s.c4), share: share(s.c4) }] : []),
          ...(Math.abs(s.other) > 0.5 && Math.abs(s.other) >= total * 0.001 ? [{ k: "Расходы ТЗ и прочее", v: money(s.other), share: share(s.other) }] : []),
          { k: "Работа", v: money(s.work), share: share(s.work) },
        ]} />
        <div className="row-total mt-2 flex items-center justify-between gap-3 rounded-md px-2 py-1 text-xs">
          <span><TotalLabel unit="₽" /></span><span className="tabular-nums">{money(total)}</span>
        </div>
      </a>
        <div className="absolute right-3 top-3">
          <InfoHint label="Как считается ремонт" wide align="right">
            <p>Те же формулы, что в блоке «Производство» на Главной: материалы — списания в ТЗ (с 4 % в режиме «С 4 %»), работа — цена работы подрядчика × количество. Режим НДС — общий переключатель шапки ({vat === "incl" ? "с НДС" : "без НДС"}).</p>
          </InfoHint>
        </div>
      </div>
    </div>
    </WidgetRow>
  );
}
