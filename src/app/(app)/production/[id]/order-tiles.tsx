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
 * Итоги ТЗ плитками в формате Главной: себестоимость, на 1 изделие, количество, работа, 4%, НДС.
 * Считаются из тех же данных ТЗ, что окно «Стоимость производства» на Главной и таблица «Состав себестоимости по лотам».
 */
export function OrderTiles({ order: o, c4, plannedQty, producedQty, completed, noUsages = false, vatRows }: { order: DrillOrder; c4: "on" | "off"; plannedQty: string; producedQty: string; completed: boolean; /** В ТЗ нет списаний сырья со склада (лоскут, давальческое сырьё). */ noUsages?: boolean; /** Ставки НДС строк списаний (с учётом 4% в режиме «С 4%»): сумма НДС и сумма строк по каждой ставке. */ vatRows: { rate: number; vat: number; incl: number }[] }) {
  const { mode: vat } = useVatDisplay();
  const s = sumOrders([o], vat);
  const total = sumTotal(s);
  const qty = o.qty;
  // ОДНА сумма НДС на карточке: НДС строк списаний вместе с 4% (l.i / l.e уже с надбавкой) — та же, что в «Составе по лотам».
  const vatSum = o.lines.reduce((a, l) => a + (l.i - l.e), 0);
  const vatRates = vatRows.map((r) => `${r.rate} %`).join(" / ");
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
      <div className="grid grid-cols-2 items-stretch gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tile("Себестоимость", money(total), `${modeLabel}${c4 === "on" ? ", с 4%" : ""}`, <p>Мех + подкладка{c4 === "on" ? " + 4%" : ""} + расходы ТЗ + работа. Мех {money(s.fur)}, подкладка {money(s.lining)}, расходы и прочее {money(s.other)}, работа {money(s.work)}. Та же цифра — в «Стоимости производства» на Главной и в «Изделиях».</p>)}
        {tile("На 1 изделие", qty > 0 ? money(total / qty) : "—", qty > 0 ? (noUsages ? `÷ ${formatQty(qty)} шт. · без сырья со склада` : `÷ ${formatQty(qty)} шт.`) : "изделий нет", <><p>Себестоимость ТЗ с работой ÷ количество ({completed ? "факт" : "план"}).</p>{noUsages ? <p className="mt-1">В этой позиции нет списаний сырья со склада (лоскут, давальческое сырьё): в цифру входят только работа и расходы. В средних по ТЗ такие позиции считайте отдельно.</p> : null}</>)}
        {tile("Количество", `${formatQty(qty || plannedQty)} шт.`, completed ? `план ${formatQty(plannedQty)} / факт ${formatQty(producedQty)}` : `план ${formatQty(plannedQty)}`)}
        {tile("Работа", money(s.work), qty > 0 && s.work > 0 ? `${formatMoney(Math.round(s.work / qty))} × ${formatQty(qty)} шт.` : "цена не указана")}
        {tile("4%", c4 === "on" ? money(s.c4) : "—", c4 === "on" ? "надбавка на мех и подкладку" : "режим «Без 4%»", <p>Надбавка посредника 4% к меху и подкладке. Режим «С 4% / Без 4%» — общий переключатель в шапке; галочка «4%» в строке списания включает или отключает надбавку для этой строки.</p>)}
        {tile("НДС в списаниях", money(vatSum), vatRates ? `в т.ч. НДС ${vatRates}` : "в т.ч. НДС", <><p>НДС строк списаний вместе с 4 % (как в расчёте себестоимости): ставка — у лота (20 % / 22 %), если ставку ТЗ не меняли. Входит в суммы «С НДС» и не входит в «Без НДС». Работа и расходы НДС не содержат. Это единственная сумма НДС на карточке: таблица «Состав по лотам» даёт ту же цифру.</p>{vatRows.length > 0 ? <ul className="mt-1 list-disc pl-4">{vatRows.map((r) => <li key={r.rate}>НДС {r.rate} %: {money(r.vat)} из {money(r.incl)}</li>)}</ul> : null}</>)}
      </div>
    </WidgetRow>
  );
}
