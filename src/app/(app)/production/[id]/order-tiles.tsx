"use client";

import { useVatDisplay } from "@/lib/vat-display";
import { formatMoney, formatQty } from "@/lib/utils";
import { InfoHint } from "@/components/info-hint";
import type { DrillOrder } from "@/lib/dashboard-drill";
import { sumOrders, sumTotal } from "@/lib/orders-sum";
import { WidgetRow } from "@/components/widget-row";
import { TILE_BOX, TileCaption, TileHead, TileValue } from "@/app/(app)/dashboard/tile";

const money = (v: number) => (Math.abs(v) < 0.5 ? "—" : formatMoney(Math.round(v)));

/**
 * Итоги ТЗ плитками в формате Главной: себестоимость, на 1 изделие, количество, работа, 4%, НДС.
 * Считаются из тех же данных ТЗ, что окно «Стоимость производства» на Главной и таблица «Состав себестоимости по лотам».
 */
export function OrderTiles({ order: o, c4, plannedQty, producedQty, completed }: { order: DrillOrder; c4: "on" | "off"; plannedQty: string; producedQty: string; completed: boolean }) {
  const { mode: vat } = useVatDisplay();
  const s = sumOrders([o], vat);
  const total = sumTotal(s);
  const qty = o.qty;
  const vatSum = o.lines.reduce((a, l) => a + (l.i - l.ci) - (l.e - l.ce), 0);
  const modeLabel = vat === "incl" ? "с НДС" : "без НДС";
  const tile = (head: string, value: string, caption: string, hint: React.ReactNode) => (
    <div className="relative">
      <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
        <TileHead>{head}</TileHead>
        <TileValue>{value}</TileValue>
        <TileCaption>{caption}</TileCaption>
      </div>
      <div className="absolute right-3 top-3">
        <InfoHint label={head} wide align="right">{hint}</InfoHint>
      </div>
    </div>
  );
  return (
    <WidgetRow id="tz" title="Итоги ТЗ">
      <div className="grid grid-cols-2 items-stretch gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tile("Себестоимость", money(total), `${modeLabel}${c4 === "on" ? ", с 4%" : ""}`, <p>Мех + подкладка{c4 === "on" ? " + 4%" : ""} + расходы ТЗ + работа. Мех {money(s.fur)}, подкладка {money(s.lining)}, расходы и прочее {money(s.other)}, работа {money(s.work)}. Та же цифра — в «Стоимости производства» на Главной и в «Изделиях».</p>)}
        {tile("На 1 изделие", qty > 0 ? money(total / qty) : "—", qty > 0 ? `÷ ${formatQty(qty)} шт.` : "изделий нет", <p>Себестоимость ТЗ с работой ÷ количество ({completed ? "факт" : "план"}).</p>)}
        {tile("Количество", `${formatQty(qty || plannedQty)} шт.`, completed ? `план ${formatQty(plannedQty)} / факт ${formatQty(producedQty)}` : `план ${formatQty(plannedQty)}`, <p>Плановое количество; у завершённого ТЗ — фактический выпуск. Правится в таблице «Параметры ТЗ».</p>)}
        {tile("Работа", money(s.work), qty > 0 && s.work > 0 ? `${formatMoney(Math.round(s.work / qty))} × ${formatQty(qty)} шт.` : "цена не указана", <p>Цена работы заказчику за штуку × количество. Не облагается НДС и 4%.</p>)}
        {tile("4%", c4 === "on" ? money(s.c4) : "—", c4 === "on" ? "надбавка на мех и подкладку" : "режим «Без 4%»", <p>Надбавка посредника 4% к меху и подкладке. Режим «С 4% / Без 4%» — общий переключатель в шапке; галочка «4%» в строке списания включает или отключает надбавку для этой строки.</p>)}
        {tile("НДС в списаниях", money(vatSum), "внутри цен лотов", <p>Сумма НДС в списанных лотах (ставка — у лота: 20% / 22%). Входит в суммы «С НДС» и не входит в «Без НДС». Работа и расходы НДС не содержат.</p>)}
      </div>
    </WidgetRow>
  );
}
