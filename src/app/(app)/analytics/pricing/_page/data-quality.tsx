import Link from "next/link";
import type { PriceAgg } from "@/lib/analytics-pricing";
import { orderLabel } from "./format";

type OrderRef = { id: string; workOrderNumber: string | null; number: string };

export function DataQuality({
  modelsNoPrice,
  modelsBelow,
  modelsNoUsages,
  modelsZero,
  inWorkNoCost,
  noWorkOrders,
  noPriceHref,
}: {
  modelsNoPrice: PriceAgg[];
  modelsBelow: PriceAgg[];
  modelsNoUsages: PriceAgg[];
  modelsZero: PriceAgg[];
  inWorkNoCost: OrderRef[];
  noWorkOrders: OrderRef[];
  noPriceHref: string;
}) {
  const linkList = (rs: { id: string; workOrderNumber: string | null; number: string }[], limit = 40) => (
    <span className="flex flex-wrap gap-x-2 gap-y-1">
      {rs.slice(0, limit).map((r) => (
        <Link key={r.id} href={`/production/${r.id}`} title={`Внутренний номер ${r.number}`} className="underline underline-offset-2">{orderLabel(r)}</Link>
      ))}
      {rs.length > limit && <span className="text-neutral-500">…и ещё {rs.length - limit}</span>}
    </span>
  );
  const modelLinks = (ms: PriceAgg[]) => (
    <span className="flex flex-wrap gap-x-2 gap-y-1">
      {ms.map((m) => (
        <Link key={m.key} href={`/models/${m.key}`} className="underline underline-offset-2">{m.label}</Link>
      ))}
    </span>
  );

  return (
    <details className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
      <summary className="block-title cursor-pointer">Качество данных</summary>
  
      <ul className="mt-2 flex flex-col gap-2">
        <li>
          Моделей без цены (с завершёнными ТЗ): <b>{modelsNoPrice.length}</b>
          {modelsNoPrice.length > 0 && (
            <div className="mt-1 text-xs">
              {modelLinks(modelsNoPrice)}{" "}
              <Link href={noPriceHref} className="ml-2 text-neutral-600 underline underline-offset-2">показать в таблице</Link>
            </div>
          )}
        </li>
        <li>
          Цена ниже себестоимости: <b>{modelsBelow.length}</b>
          {modelsBelow.length > 0 && <div className="mt-1 text-xs">{modelLinks(modelsBelow)}</div>}
        </li>
        <li>
          Модели, у которых есть завершённые ТЗ без состава материалов: <b>{modelsNoUsages.length}</b>
          {modelsNoUsages.length > 0 && <div className="mt-1 text-xs">{linkList(modelsNoUsages.flatMap((m) => m.noUsages))}</div>}
        </li>
        <li>
          Завершённые ТЗ с себестоимостью 0: <b>{modelsZero.reduce((s, m) => s + m.zeroCost.length, 0)}</b>
          {modelsZero.length > 0 && <div className="mt-1 text-xs">{linkList(modelsZero.flatMap((m) => m.zeroCost))}</div>}
          {inWorkNoCost.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-neutral-600">ТЗ «в работе» с себестоимостью 0: {inWorkNoCost.length} (партии без списаний, в расчёт не входят)</summary>
              <div className="mt-1 text-xs">{linkList(inWorkNoCost)}</div>
            </details>
          )}
        </li>
        <li>
          Завершённые ТЗ без цены работы: <b>{noWorkOrders.length}</b>
          {noWorkOrders.length > 0 && <div className="mt-1 text-xs">{linkList(noWorkOrders)}</div>}
        </li>
        <li className="text-xs text-neutral-500">
          Отдельной оптовой цены в базе нет — используется розничная цена модели. Фурнитура и прочие материалы в ТЗ не списываются: в составе только мех и подкладка.
        </li>
      </ul>
      <div className="mt-3 text-xs text-neutral-500">
        Что произведено — на вкладке{" "}
        <Link href="/analytics/products" className="underline underline-offset-2">«Изделия»</Link>; цены правятся на странице{" "}
        <Link href="/articles" className="underline underline-offset-2">«Изделия» (меню)</Link>.
      </div>
    </details>
  );
}
