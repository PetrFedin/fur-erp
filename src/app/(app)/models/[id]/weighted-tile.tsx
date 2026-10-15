import { InfoHint } from "@/components/info-hint";
import { Money } from "@/components/money";
import { formatQty } from "@/lib/utils";
import type { ArticleMetrics } from "@/lib/article-metrics";
import { sumOrders, type Sum } from "@/lib/orders-sum";
import type { DrillOrder } from "@/lib/dashboard-drill";
import { TILE_BOX, TileCaption, TileHead, TileList, TileValue } from "../../dashboard/tile";

const per = (q: number, n: number) => (n > 0 ? formatQty(Math.round((q / n) * 100) / 100) : "—");
const mat = (s: Sum) => s.fur + s.lining + s.c4;

/**
 * Пятая плитка верхнего ряда: «Средневзвешенные» по изделиям артикула. Всё считается из ТЗ артикула суммой ÷ количество
 * (не среднее по ТЗ): расход меха и подкладки на изделие, цена шкуры и метра подкладки, материалы и работа на изделие.
 */
export function WeightedTile({ met, orders }: { met: ArticleMetrics; orders: DrillOrder[] }) {
  const sI = sumOrders(orders, "incl");
  const sE = sumOrders(orders, "excl");
  const n = met.qty;
  const kinds = met.furKinds.filter((k) => k.qty > 0);
  const shown = kinds.slice(0, 3);
  const priced = (on: { incl: number; excl: number }, q: number, suffix: string) => (
    <><Money incl={(on.incl / q).toFixed(2)} excl={(on.excl / q).toFixed(2)} />{suffix}</>
  );
  return (
    <div className="relative">
      <div className={TILE_BOX + " shadow-sm print:shadow-none"}>
        <TileHead>Средневзвешенные</TileHead>
        <TileValue>{n > 0 && met.fur.qty > 0 ? `${per(met.fur.qty, n)} шк.` : "—"}</TileValue>
        <TileCaption>{n > 0 ? "расход меха на изделие" : "изделий нет"}</TileCaption>
        {n > 0 ? (
          <TileList items={[
            ...shown.map((k) => ({ k: k.fur, v: priced(k.on, k.qty, "/шк.") })),
            ...(met.lining.qty > 0 ? [
              { k: "Подкладка на изделие", v: `${per(met.lining.qty, n)} м` },
              { k: "Подкладка за метр", v: priced(met.lining.on, met.lining.qty, "/м") },
            ] : []),
            { k: "Материалы на изделие", v: <Money incl={(mat(sI) / n).toFixed(2)} excl={(mat(sE) / n).toFixed(2)} /> },
            { k: "Работа на изделие", v: <Money incl={(sI.work / n).toFixed(2)} excl={(sI.work / n).toFixed(2)} /> },
          ]} />
        ) : null}
      </div>
      <div className="absolute right-3 top-3">
        <InfoHint label="Как считаются средневзвешенные" wide align="right">
          <p>Сумма по всем ТЗ артикула ÷ число изделий ({formatQty(n)} шт.), а не среднее по ТЗ: ТЗ на 10 изделий весит больше, чем на 1. Цена шкуры — все списания меха этого вида ÷ шкуры (с 4%). Материалы на изделие = мех + подкладка + 4%; работа — цена работы по ТЗ.</p>
        </InfoHint>
      </div>
    </div>
  );
}
