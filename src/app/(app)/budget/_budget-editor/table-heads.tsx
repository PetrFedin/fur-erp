"use client";

import { formatPercent, formatDec1 } from "@/lib/utils";
import { type Agg, type BudgetParams } from "@/lib/budget-calc";
import { money, qty } from "../ui";
import { TotalLabel } from "@/components/total-label";
import { Avg, Th, sepL } from "./parts";

/** Шапки таблиц «Сводка», «На 1 изделие», «Детально» и строка итога «Детально». */
const grp = `${sepL} border-b border-neutral-200 px-2 py-0 align-middle text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-500`;

export function SummaryHead() {
  return (
              <thead className="sticky top-0 z-20 bg-white print:static">
                <tr className="h-7">
                  <th rowSpan={2} scope="col" className="sticky left-0 z-30 min-w-[120px] border-b border-r border-neutral-200 bg-white px-2 text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-500 print:static">Тип сырья · категория</th>
                  <th colSpan={2} className="border-b border-neutral-200 px-2 py-0 align-middle text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Количество</th>
                  <th colSpan={4} className={grp}>Затраты</th>
                  <th colSpan={2} className={grp}>Прогноз</th>
                </tr>
                <tr className="[&>th]:border-b [&>th]:border-neutral-200">
                  <Th tip="Бюджет изделий, шт." unit="шт.">Изделий</Th>
                  <Th tip="Всего шкур на эти изделия" unit="шт.">Шкур</Th>
                  <Th tip="Мех = шкуры × цена шкуры" className={sepL} unit="₽">Мех</Th>
                  <Th tip="Подкладка = метры × цена за метр" unit="₽">Подкладка</Th>
                  <Th tip="Работа = изделия × работа на изделие" unit="₽">Работа</Th>
                  <Th tip="Надбавка на мех и подкладку" unit="₽">4 %</Th>
                  <Th tip="Мех + подкладка + работа + 4 %; под цифрой доля в общем итоге" className={sepL} unit="₽">Всего</Th>
                  <Th tip="Всего, ₽ ÷ изделий" unit="₽/шт.">На 1 изд.</Th>
                </tr>
              </thead>
  );
}

export function UnitHead({ params }: { params: BudgetParams }) {
  return (
                <thead className="sticky top-0 z-20 bg-white">
                  <tr className="h-7">
                    <th rowSpan={2} scope="col" className="sticky left-0 z-30 min-w-[180px] border-b border-r border-neutral-200 bg-white px-2 text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Тип сырья · категория · длина</th>
                    <th rowSpan={2} scope="col" className="border-b border-neutral-200 px-2 text-right text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Бюджет, шт.</th>
                    <th colSpan={3} className={"border-b px-2 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-500 " + sepL}>Мех</th>
                    <th colSpan={3} className={"border-b px-2 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-500 " + sepL}>Подкладка</th>
                    <th colSpan={2} className={"border-b px-2 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-500 " + sepL}>Работа и надбавка</th>
                    <th colSpan={2} className={"border-b px-2 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-500 " + sepL}>Себестоимость</th>
                  </tr>
                  <tr className="h-9 border-b border-neutral-200 text-[11px] font-medium text-neutral-500 [&>th]:border-b [&>th]:border-neutral-200 [&>th]:px-1.5 [&>th]:text-right [&>th]:font-medium">
                    <th className={sepL}>шкур, шт.</th><th>цена шкуры</th><th>сумма</th>
                    <th className={sepL}>метров</th><th>цена за м</th><th>сумма</th>
                    <th className={sepL}>работа</th><th>+{formatPercent(params.c4)}</th>
                    <th className={sepL}>на 1 изд.</th><th>сейчас</th>
                  </tr>
                </thead>
  );
}

export function DetailHead() {
  return (
              <thead className="sticky top-0 z-20 bg-white">
                <tr className="h-7">
                  <th rowSpan={2} scope="col" className="sticky left-0 z-30 min-w-[200px] border-b border-r border-neutral-200 bg-white px-3 text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-500 lg:min-w-[270px]">Тип сырья · категория · артикул</th>
                  <th colSpan={3} className={grp}>Количество</th>
                  <th colSpan={4} className={grp}>Цены на 1 изделие</th>
                  <th colSpan={6} className={grp}>Прогноз</th>
                  <th rowSpan={2} scope="col" className="min-w-[190px] border-b border-l border-neutral-200 bg-white px-2 text-right text-[11px] font-semibold uppercase tracking-wide text-neutral-500 lg:sticky lg:right-0 lg:z-30">Действия</th>
                </tr>
                <tr className="[&>th]:border-b [&>th]:border-neutral-200">
                  <Th tip="Сколько изделий заложено в бюджет" className={sepL} unit="шт.">Бюджет</Th>
                  <Th tip="Сколько шкур уходит на одно изделие" unit="шт./изд.">Шкур на изделие</Th>
                  <Th tip="Бюджет изделий × шкур на изделие" unit="шт.">Всего шкур</Th>
                  <Th tip="Цена одной шкуры, ₽. Зелёный процент слева — применённая надбавка; жирный и подчёркнутый — задана на этой строке. Ручная правка закрывает замок" className={sepL} unit="₽/шт.">Цена шкуры</Th>
                  <Th tip="Подкладка, метров на одно изделие" unit="м/изд.">Подкладка на изделие</Th>
                  <Th tip="Цена подкладки за метр, ₽" unit="₽/м">Цена подкладки</Th>
                  <Th tip="Стоимость работы на одно изделие, ₽" unit="₽/шт.">Работа на изделие</Th>
                  <Th tip="Мех = всего шкур × цена шкуры" className={sepL} unit="₽">Мех</Th>
                  <Th tip="Подкладка = бюджет × м на изделие × цена за метр" unit="₽">Подкладка</Th>
                  <Th tip="Работа = бюджет × работа на изделие" unit="₽">Работа</Th>
                  <Th tip="Надбавка на мех и подкладку (по умолчанию 4 %)" unit="₽">4 %</Th>
                  <Th tip="Мех + подкладка + работа + 4 %" unit="₽">Всего</Th>
                  <Th tip="Всего, ₽ ÷ бюджет изделий" unit="₽/шт.">На 1 изд.</Th>
                </tr>
              </thead>
  );
}

export function TotalRowDetail({ total, scopeName }: { total: Agg; scopeName: string }) {
  return (
    <tr key="total" className="row-total">
      <td className="sticky left-0 z-10 border-r border-neutral-200 px-3 py-2 text-sm"><><TotalLabel />{scopeName ? <span className="font-normal"> · {scopeName}</span> : null}</></td>
      <td className={`whitespace-nowrap px-2 text-right text-sm tabular-nums ${sepL}`}>{qty(total.pcs, 0)}</td>
      <td />
      <td className="px-2 text-right text-xs tabular-nums text-neutral-700">{formatDec1(total.hides)}<Avg sum={total.hides} per={total.pcs} unit="шк./изд." d={1} /></td>
      <td className={sepL} colSpan={4} />
      <td className={`whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-700 ${sepL}`}>{money(total.mex)}<Avg sum={total.mex} per={total.hides} unit="₽/шт." /></td>
      <td className="whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-700">{money(total.lining)}<Avg sum={total.lining} per={total.meters} unit="₽/м" /></td>
      <td className="whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-700">{money(total.work)}<Avg sum={total.work} per={total.pcs} unit="₽/изд." /></td>
      <td className="whitespace-nowrap px-2 text-right text-xs tabular-nums text-neutral-600">{money(total.c4)}<Avg sum={total.c4} per={total.pcs} unit="₽/изд." /></td>
      <td className="whitespace-nowrap px-2 text-right text-sm tabular-nums">{money(total.total)}</td>
      <td className="whitespace-nowrap px-2 text-right text-sm tabular-nums text-neutral-600">–</td>
      <td className="border-l border-neutral-200 lg:sticky lg:right-0 lg:z-10" />
    </tr>
  );
}
