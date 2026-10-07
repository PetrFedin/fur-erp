"use server";

import { requireSession } from "@/lib/session";
import { getYearFilter } from "@/lib/year-filter";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { parseFilters } from "@/lib/filters";
import { DASH_FILTERS, type DashFilters } from "@/lib/dashboard-calc";
import { loadDrillOrders } from "@/lib/dashboard-data";
import type { DrillData } from "@/lib/dashboard-drill";

const TTL_MS = 15_000;
const MAX_ORDERS = 1500;
const cache = new Map<string, { at: number; value: Promise<DrillData> }>();

/**
 * Данные окна «Стоимость производства» Сводки: ТЗ с составом списаний (лениво, только при открытии окна).
 * Организация, год и режим 4% берутся из сессии и cookie, фильтры — из параметров Сводки (значения проверяет parseFilters).
 */
export async function loadProductionDrill(scope: "done" | "work", search: Record<string, string[]>): Promise<DrillData> {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const sc = scope === "work" ? "work" : "done";
  const safe: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(search ?? {})) if (Array.isArray(v)) safe[String(k).slice(0, 20)] = v.slice(0, 60).map((s) => String(s).slice(0, 300));
  const f = parseFilters(DASH_FILTERS, safe) as unknown as DashFilters;
  const [year, c4] = await Promise.all([getYearFilter(), getCommission4Mode()]);
  const key = `${orgId}|${year}|${c4}|${sc}|${JSON.stringify(f)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = loadDrillOrders(orgId, year, f, c4, sc).then((orders) => ({ c4, orders: orders.slice(0, MAX_ORDERS) }));
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}
