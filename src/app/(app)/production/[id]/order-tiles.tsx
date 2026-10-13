"use client";

import Link from "next/link";
import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import type { DrillOrder } from "@/lib/dashboard-drill";
import { sumOrders, sumTotal } from "@/lib/orders-sum";
import { WidgetRow } from "@/components/widget-row";
import { TILE_BOX, TileCaption, TileHead, TileValue } from "@/app/(app)/dashboard/tile";

const money = (v: number) => (Math.abs(v) < 0.5 ? "—" : formatMoney(Math.round(v)));

/**
 * Итоги ТЗ плитками в формате Главной: себестоимость, на 1 изделие, 4%.
 * Считаются из тех же данных ТЗ, что окно «Стоимость производства» на Главной и таблица «Состав себестоимости по лотам».
 */
export function OrderTiles({ order: o, c4, completed, noUsages = false }: { order: DrillOrder; c4: "on" | "off"; completed: boolean; /** В ТЗ нет списаний сырья со склада (лоскут, давальческое сырьё). */ noUsages?: boolean }) {
  const { mode: vat } = useVatDisplay();
  const s = sumOrders([o], vat);
  const total = sumTotal(s);
  const qty = o.qty;
  const modeLabel = vat === "incl" ? "с НДС" : "без НДС";
  const tile = (head: string, value: string, caption: string, hint?: React.ReactNode) => (
    <div className="relative">
      <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
        <TileHead>{head}</TileHead>
        <TileValue>{value}</TileValue>
        <TileCaption>{caption}</TileCaption>
      </div>
      {hint ? (
        <div className="absolute right-3 top-3">
          <InfoHint label={head} wide align="right">{hint}</InfoHint>
        </div>
      ) : null}
    </div>
  );
  return (
    <WidgetRow id="tz" title="Итоги ТЗ" headerEnd={<Link href="/production" className="text-xs text-blue-700 hover:underline print:hidden">→ ТЗ</Link>}>
      <div className="grid grid-cols-2 items-stretch gap-3 md:grid-cols-3 xl:grid-cols-3">
        {tile("Себестоимость", money(total), `${modeLabel}${c4 === "on" ? ", с 4%" : ""}`, <p>Мех + подкладка{c4 === "on" ? " + 4%" : ""} + расходы ТЗ + работа. Мех {money(s.fur)}, подкладка {money(s.lining)}, расходы и прочее {money(s.other)}, работа {money(s.work)}. Та же цифра — в «Стоимости производства» на Главной и в «Изделиях».</p>)}
        {tile("На 1 изделие", qty > 0 ? money(total / qty) : "—", qty > 0 ? (noUsages ? `÷ ${formatQty(qty)} шт. · без сырья со склада` : `÷ ${formatQty(qty)} шт.`) : "изделий нет", <><p>Себестоимость ТЗ с работой ÷ количество ({completed ? "факт" : "план"}).</p>{noUsages ? <p className="mt-1">В этой позиции нет списаний сырья со склада (лоскут, давальческое сырьё): в цифру входят только работа и расходы. В средних по ТЗ такие позиции считайте отдельно.</p> : null}</>)}
        {tile("4%", c4 === "on" ? money(s.c4) : "—", c4 === "on" ? "надбавка на мех и подкладку" : "режим «Без 4%»", <p>Надбавка посредника 4% к меху и подкладке. Режим «С 4% / Без 4%» — общий переключатель в шапке; галочка «4%» в строке списания включает или отключает надбавку для этой строки.</p>)}
      </div>
    </WidgetRow>
  );
}
