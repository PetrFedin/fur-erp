import "server-only";
import type { PrismaClient } from "@prisma/client";
import { purchasedTotals, type PurchasedParts, type PurchasedTotals } from "@/domain/purchased";

type Db = Pick<PrismaClient, "$queryRaw">;
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/**
 * Состав «Куплено» из таблиц витрины (DmLot, DmLotBridge, DmPurchase): единственное место, где SQL витрины складывается в части для
 * домена (src/domain/purchased.ts). unit: «PCS» — мех, «M» — подкладка, не задан — всё сырьё.
 * «Заказано, не получено» в витрине лежит у меха (DmLotBridge); доплата подрядчику — из оплат (pay:overview); услуги по УПД — закупки без позиций с расходами
 * (в витрине хранятся только с НДС: без НДС равны «с НДС», в расчётах без НДС не участвуют).
 */
export async function loadPurchasedParts(db: Db, orgId: string, unit?: "PCS" | "M"): Promise<PurchasedParts> {
  const [lots] = await db.$queryRaw<{ i: string | null; x: string | null }[]>`
    SELECT sum("totalCost")::text i, sum("totalCostExcl")::text x FROM "DmLot"
    WHERE "organizationId" = ${orgId} AND (${unit ?? null}::text IS NULL OR "unit" = ${unit ?? null}::text)`;
  const bridge = unit === "M" ? [] : await db.$queryRaw<{ kind: string; i: string | null; x: string | null; ui: string | null; ux: string | null }[]>`
    SELECT kind, sum("totalCost")::text i, sum("totalCostExcl")::text x, sum("usedCost")::text ui, sum("usedCostExcl")::text ux FROM "DmLotBridge" WHERE "organizationId" = ${orgId} GROUP BY kind`;
  const [svc] = unit ? [{ i: "0" }] : await db.$queryRaw<{ i: string | null }[]>`
    SELECT sum("payTotal")::text i FROM "DmPurchase"
    WHERE "organizationId" = ${orgId} AND status <> 'CANCELLED' AND "itemsSum" = 0 AND "expensesSum" > 0`;
  // Доплата подрядчику (НДС 22 % по сырью заказчика, оплачена в составе пошива) берётся из оплат: это НДС, у неё нет варианта «без НДС».
  const { loadPaymentsOverview } = await import("@/lib/payments-overview");
  const hidesIncl = unit === "M" ? 0 : (await loadPaymentsOverview(orgId)).reduce((a, r) => a + r.hides, 0);
  const hides = { incl: hidesIncl, excl: hidesIncl };
  const of = (k: string) => { const b = bridge.find((x) => x.kind === k); return { incl: n(b?.i), excl: n(b?.x) }; };
  return {
    receivedLots: { incl: n(lots?.i), excl: n(lots?.x) },
    orderedNotReceived: of("ordered"),
    contractorHides: hides,
    services: { incl: n(svc?.i), excl: n(svc?.i) },
  };
}

export async function loadPurchasedTotals(db: Db, orgId: string, unit?: "PCS" | "M"): Promise<PurchasedTotals> {
  return purchasedTotals(await loadPurchasedParts(db, orgId, unit));
}
