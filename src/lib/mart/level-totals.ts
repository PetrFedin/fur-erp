import { overpayTarget } from "@/lib/overpay-notes";
import { transferOverpay } from "@/domain/money";
import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isMartFresh } from "@/lib/mart/snapshots";

/**
 * Итоги уровня («Сырьё»: аукцион, закупка, лот, партия подкладки) из витрины: куплено, использовано, остаток, $ за шкуру, оплачено и долг.
 * Источник один — DmLot, DmAuction, DmPurchase; экраны ничего не пересчитывают. Витрина устарела (после неё были записи) — null,
 * и экран считает вживую, как раньше.
 */
export type Sum = { recv: number; used: number; rem: number; extra: number };
export type LevelTotals = {
  lots: number;
  qty: { recv: number; used: number; rem: number };
  incl: Sum;
  excl: Sum;
  usdAvg: number | null;
  /** Оплаты (с НДС): итог по документам, оплачено, остаток (отрицательный — переплата). null — для уровня оплат нет (лот). */
  pay: { total: number; paid: number; remaining: number } | null;
  /** Верхний уровень меха: «заказано, не получено» (лотов нет) — входит в куплено и остаток. */
  ordered?: { qty: number } | null;
};
/** top — весь мех или вся подкладка (без среза): к лотам добавляются строки «заказано, не получено» моста (DmLotBridge). */
export type LevelScope = { auctions?: string[]; purchaseId?: string; lotId?: string; unit?: "M" | "PCS"; top?: boolean };

const num = (v: unknown) => (v == null ? 0 : Number(v));

export async function loadLevelTotals(orgId: string, scope: LevelScope): Promise<LevelTotals | null> {
  if (!(await isMartFresh(orgId))) return null;
  const where: Prisma.Sql[] = [Prisma.sql`d."organizationId" = ${orgId}`];
  if (scope.lotId) where.push(Prisma.sql`d."lotId" = ${scope.lotId}`);
  if (scope.purchaseId) where.push(Prisma.sql`d."purchaseId" = ${scope.purchaseId}`);
  if (scope.auctions?.length) where.push(Prisma.sql`d."auction" IN (${Prisma.join(scope.auctions)})`);
  if (scope.unit) where.push(Prisma.sql`d."unit" = ${scope.unit}`);
  const [r] = await prisma.$queryRaw<Record<string, string | number | null>[]>`
    SELECT count(*)::int lots,
      sum(d."qtyReceived") rq, sum(d."qtyUsed") uq, sum(d."qtyRemaining") mq,
      sum(d."totalCost") ri, sum(d."totalCostExcl") rx, sum(d."usedCost") ui, sum(d."usedCostExcl") ux,
      sum(d."usedExtraIncl") ei, sum(d."usedExtraExcl") ex, sum(d."remCost") mi, sum(d."remCostExcl") mx,
      sum(d."usdUnit" * d."qtyReceived") FILTER (WHERE d."usdUnit" IS NOT NULL) usd_sum,
      sum(d."qtyReceived") FILTER (WHERE d."usdUnit" IS NOT NULL) usd_qty
    FROM "DmLot" d WHERE ${Prisma.join(where, " AND ")}`;
  if (!r || !num(r.lots)) return null;

  let pay: LevelTotals["pay"] = null;
  // Верхний уровень: мех = лоты + «заказано, не получено» (мост); оплаты — по аукционам меха/подкладки плюс закупки без аукциона, всё из DmAuction и DmPurchase.
  let bridge: { rq: number; mq: number; ri: number; rx: number; mi: number; mx: number } | null = null;
  if (scope.top && scope.unit) {
    if (scope.unit === "PCS") {
      const [b] = await prisma.$queryRaw<Record<string, string | null>[]>`SELECT sum("qtyReceived") rq, sum("qtyRemaining") mq, sum("totalCost") ri, sum("totalCostExcl") rx, sum("remCost") mi, sum("remCostExcl") mx FROM "DmLotBridge" WHERE "organizationId" = ${orgId} AND kind = 'ordered'`;
      bridge = { rq: num(b?.rq), mq: num(b?.mq), ri: num(b?.ri), rx: num(b?.rx), mi: num(b?.mi), mx: num(b?.mx) };
    }
    const unit = scope.unit;
    // Оплаты верхнего уровня — по закупкам, из которых сделаны лоты этого вида (и черновики «заказано, не получено»): итог закупки и доля оплат из DmPurchase.
    // Так «Куплено − Оплачено = Долг» сходится арифметически на любом уровне.
    const [p] = await prisma.$queryRaw<Record<string, string | null>[]>`
      SELECT coalesce(sum(dp."payTotal"), 0) total, coalesce(sum(dp."paidShare"), 0) paid, coalesce(sum(dp."payTotal" - dp."paidShare"), 0) remaining
      FROM "DmPurchase" dp
      WHERE dp."organizationId" = ${orgId} AND dp.status <> 'CANCELLED' AND (
        EXISTS (SELECT 1 FROM "DmLot" l WHERE l."organizationId" = ${orgId} AND l."purchaseId" = dp."purchaseId" AND l."unit" = ${unit})
        ${unit === "PCS" ? Prisma.sql`OR (dp.status = 'DRAFT' AND btrim(split_part(dp."auction", E'\n', 1)) IN (SELECT "auction" FROM "DmLotBridge" WHERE "organizationId" = ${orgId} AND kind = 'ordered'))` : Prisma.empty}
      )`;
    pay = { total: num(p?.total), paid: num(p?.paid), remaining: num(p?.remaining) };
    // Переплата аукциона, зачтённая по документам в счёте другого аукциона (подкладка 05.26 → AME 05.26): на верхнем уровне оплата
    // переносится туда, как на Главной. Внутри самого аукциона переплата остаётся видна.
    const over = await prisma.dmAuction.findMany({ where: { organizationId: orgId, remaining: { lt: -0.5 } }, select: { name: true, remaining: true } });
    if (over.length) {
      const rows = await prisma.$queryRaw<{ auction: string | null }[]>`SELECT DISTINCT "auction" FROM "DmLot" WHERE "organizationId" = ${orgId} AND "unit" = ${unit}`;
      const mine = new Set(rows.map((x) => x.auction).filter((x): x is string => !!x));
      pay = transferOverpay(pay, over.map((o) => ({ name: o.name, amount: -num(o.remaining), to: overpayTarget(o.name) })), mine);
    }
  }
  if (scope.purchaseId) {
    const p = await prisma.dmPurchase.findFirst({ where: { organizationId: orgId, purchaseId: scope.purchaseId }, select: { payTotal: true, paidShare: true } });
    if (p) pay = { total: num(p.payTotal), paid: num(p.paidShare), remaining: num(p.payTotal) - num(p.paidShare) };
  } else if (scope.auctions?.length && !scope.lotId) {
    const a = await prisma.dmAuction.findMany({ where: { organizationId: orgId, name: { in: scope.auctions } }, select: { total: true, paid: true, remaining: true } });
    if (a.length) pay = { total: a.reduce((s, x) => s + num(x.total), 0), paid: a.reduce((s, x) => s + num(x.paid), 0), remaining: a.reduce((s, x) => s + num(x.remaining), 0) };
  }
  const bq = bridge ?? { rq: 0, mq: 0, ri: 0, rx: 0, mi: 0, mx: 0 };
  return {
    lots: num(r.lots),
    qty: { recv: num(r.rq) + bq.rq, used: num(r.uq), rem: num(r.mq) + bq.mq },
    incl: { recv: num(r.ri) + bq.ri, used: num(r.ui), rem: num(r.mi) + bq.mi, extra: num(r.ei) },
    excl: { recv: num(r.rx) + bq.rx, used: num(r.ux), rem: num(r.mx) + bq.mx, extra: num(r.ex) },
    usdAvg: num(r.usd_qty) > 0 ? num(r.usd_sum) / num(r.usd_qty) : null,
    pay,
    ordered: bridge && bridge.rq > 0 ? { qty: bridge.rq } : null,
  };
}
