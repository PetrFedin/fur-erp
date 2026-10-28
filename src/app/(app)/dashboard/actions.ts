"use server";

import { requireSession } from "@/lib/session";
import { getYearFilter } from "@/lib/year-filter";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { lotFiltersOn, orderFiltersOn, parseDashFilters } from "@/lib/dashboard-calc";
import { NO_GROUP } from "@/lib/category-groups";

import { loadDrillOrders, receivedWithoutTz } from "@/lib/dashboard-data";
import type { DrillData } from "@/lib/dashboard-drill";

const TTL_MS = 15_000;
const MAX_ORDERS = 1500;
const cache = new Map<string, { at: number; value: Promise<DrillData> }>();

/**
 * Данные окна «Стоимость производства» Сводки: ТЗ с составом списаний (лениво, только при открытии окна).
 * Организация, год и режим 4% берутся из сессии и cookie, фильтры — из параметров Сводки (значения проверяет parseFilters).
 */
export async function loadProductionDrill(scope: "done" | "work" | "all", search: Record<string, string[]>): Promise<DrillData> {
  const session = await requireSession();
  const orgId = session.user.organizationId;
  const sc = scope === "work" ? "work" : scope === "all" ? "all" : "done";
  const safe: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(search ?? {})) if (Array.isArray(v)) safe[String(k).slice(0, 20)] = v.slice(0, 60).map((s) => String(s).slice(0, 300));
  const f = parseDashFilters(safe);
  const [year, c4] = await Promise.all([getYearFilter(), getCommission4Mode()]);
  const key = `${orgId}|${year}|${c4}|${sc}|${JSON.stringify(f)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = loadDrillOrders(orgId, year, f, c4, sc).then(async (orders) => {
    const out = orders.slice(0, MAX_ORDERS);
    // Приход MVST РМ, под который в ТЗ нет объёма: отдельная строка без стоимости, чтобы «Произведено» в таблицах сходилось с «Получено».
    if (sc === "all" && year === "all" && !orderFiltersOn(f) && !lotFiltersOn(f)) {
      const extra = await receivedWithoutTz(orgId, c4);
      for (const [g, n] of Object.entries(extra)) out.push({ id: `no-tz-${g}`, number: "—", wo: null, bk: "none", bl: "Вне партий", y: 2026, st: "COMPLETED", cat: "Получено, ТЗ не заведены", grp: g === "Без группы" ? NO_GROUP : g, mid: `no-tz-${g}`, ml: "Получено, ТЗ не заведены", fur: "—", qty: 0, qo: 0, qd: n, work: 0, exp: 0, hI: 0, hE: 0, resI: 0, resE: 0, lines: [] });
    }
    return { c4, orders: out };
  });
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}
