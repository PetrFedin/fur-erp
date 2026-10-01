import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatQty } from "@/lib/utils";
import { batchExtraName, batchTotals, orderStat, type BatchOrder } from "@/lib/batch-stats";
import { c4Suffix } from "@/lib/commission4";
import type { Commission4Mode } from "@/lib/commission4-mode";

const STATUS: Record<string, { label: string; variant: "default" | "warning" | "success" | "danger" }> = {
  PLANNED: { label: "Запланирован", variant: "default" },
  IN_PROGRESS: { label: "В работе", variant: "warning" },
  COMPLETED: { label: "Завершён", variant: "success" },
  CANCELLED: { label: "Отменён", variant: "danger" },
};

export type GroupBatch = { id: string; number: number; name: string | null; year: number | null };

const woNum = (o: BatchOrder) => {
  const n = parseInt(o.workOrderNumber ?? "", 10);
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
};

/** Сгруппированный вид «По партиям»: партия → ТЗ → изделие, с итогами по каждой партии. */
export function GroupedByBatch({
  orders,
  batches,
  c4Mode = "off",
  filtered = false,
}: {
  orders: BatchOrder[];
  batches: GroupBatch[];
  c4Mode?: Commission4Mode;
  /** Применён фильтр (поиск, статус, заказчик, модель, партия): пустой результат — «Ничего не найдено». */
  filtered?: boolean;
}) {
  const groups: { key: string; batch: GroupBatch | null; orders: BatchOrder[] }[] = batches
    .map((b) => ({ key: b.id, batch: b, orders: orders.filter((o) => o.batchId === b.id) }))
    .filter((g) => g.orders.length > 0);
  const loose = orders.filter((o) => !o.batchId);
  if (loose.length > 0) groups.push({ key: "none", batch: null, orders: loose });

  if (groups.length === 0) {
    return (
      <p className="rounded-md bg-neutral-50 px-3 py-6 text-center text-sm text-neutral-500">
        {filtered ? "Ничего не найдено" : "Партий с ТЗ пока нет. Партия назначается ТЗ при импорте из Google Drive."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-batch-groups>
      {groups.map((g) => {
        const t = batchTotals(g.orders, c4Mode);
        const sorted = [...g.orders].sort((a, b) => woNum(a) - woNum(b));
        return (
          <details key={g.key} open className="group rounded-lg border border-neutral-200 bg-white">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-neutral-50 [&::-webkit-details-marker]:hidden">
              <span className="inline-block text-neutral-400 transition-transform group-open:rotate-90">›</span>
              {g.batch ? (
                <Link href={`/production/batches/${g.batch.number}`} className="font-medium hover:underline">
                  Партия {g.batch.number}
                  {batchExtraName(g.batch.name) ? ` · ${batchExtraName(g.batch.name)}` : ""}
                </Link>
              ) : (
                <span className="font-medium">Без партии</span>
              )}
              {g.batch?.year && <span className="text-xs text-neutral-500">{g.batch.year}</span>}
              <span className="text-xs text-neutral-500">
                ТЗ: {t.orders} · изделий: {formatQty(t.units.toString())}
              </span>
              <span className="ml-auto text-xs text-neutral-600">
                себестоимость{t.c4Applies ? c4Suffix(c4Mode) : ""} <b>{formatMoney(t.cost.toString())}</b> · работа <b>{formatMoney(t.work.toString())}</b> · оплачено{" "}
                <b>{formatMoney(t.paid.toString())}</b> ·{" "}
                {t.remaining.lessThan(-0.005) ? "переплата" : "остаток"}{" "}
                <b className={t.remaining.greaterThan(0.005) ? "text-amber-600" : ""}>{formatMoney(t.remaining.abs().toString())}</b>
              </span>
            </summary>
            <ul className="divide-y divide-neutral-100 border-t border-neutral-100 text-sm">
              {sorted.map((o) => {
                const s = orderStat(o, c4Mode);
                const st = STATUS[o.status];
                return (
                  <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <Link href={`/production/${o.id}`} className="font-medium hover:underline">
                      {o.workOrderNumber ? `ТЗ №${o.workOrderNumber}` : `Заказ ${o.number}`}
                    </Link>
                    <span className="text-neutral-700">{o.productModel.name}</span>
                    <span className="text-xs text-neutral-500">{formatQty(s.qty.toString())} шт.</span>
                    <Badge variant={st.variant}>{st.label}</Badge>
                    <span className="ml-auto text-xs text-neutral-600">
                      {s.cost.isZero() ? "—" : formatMoney(s.cost.toString())}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
      <p className="text-xs text-neutral-500">
        «Оплачено» — оплаты заказчика по ТЗ партии (каждая оплата учтена один раз, отменённые не входят); остаток = работа
        минус оплачено (если оплачено больше — «переплата»). Себестоимость {c4Mode === "on" ? "— с наценкой 4% на сырьё и подкладку (кроме списаний без 4%, напр. партия 6); работа не облагается." : "— без наценки 4% (переключатель «С 4%» в шапке)."}
      </p>
    </div>
  );
}
