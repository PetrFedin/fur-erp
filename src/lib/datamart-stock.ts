import "server-only";
import { prisma } from "@/lib/prisma";

/** Остатки из витрины datamart (dwh.vFact_Inventory_Datamart) по нашим заказам на даты снимков: штуки всего, одежда, аксессуары. Лежит в SystemState (ключ datamart-stock). */
export type DatamartStock = {
  source: string;
  loadedAt: string;
  orders: string[];
  snapshots: { date: string; total: number; rtw: number; acc: number }[];
  /** Текущий остаток по складам и магазинам (dwh.vFact_AnalyseStockOnHand) на дату загрузки витрины. */
  now?: { date: string; physical: number; avail: number; reserved: number; rtw: number; acc: number; places: { name: string; avail: number }[] };
};
export const DATAMART_STOCK_KEY = "datamart-stock";

export async function loadDatamartStock(orgId: string): Promise<DatamartStock | null> {
  try {
    const r = await prisma.systemState.findUnique({ where: { organizationId_key: { organizationId: orgId, key: DATAMART_STOCK_KEY } }, select: { value: true } });
    const v = r?.value as DatamartStock | null | undefined;
    return v && Array.isArray(v.snapshots) && v.snapshots.length ? v : null;
  } catch {
    return null;
  }
}
