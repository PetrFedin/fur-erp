// Остаток норки на складе по полу шкур: самцы (M), самки (F), пол не указан (U).
// Пол лота — из src/lib/data/mink-lot-sex.json (название лота и реестры закупок; проверено 01.11.2026). Тот же файл читает Excel «Сырьё и бюджет FW27».
import { prisma } from "@/lib/prisma";
import { loadFurLots } from "@/lib/fur-table-server";
import type { MinkSexStock } from "@/lib/budget-pcs";
import SEX from "./data/mink-lot-sex.json";

const sexOf = (lot: string): "M" | "F" | null => {
  const v = (SEX as Record<string, unknown>)[lot];
  return Array.isArray(v) && (v[0] === "M" || v[0] === "F") ? v[0] : null;
};

/** total — остаток норки на складе так, как его считает расчёт закупки; всё, что не размечено M/F, идёт в U. */
export async function loadMinkSexStock(orgId: string, total: number): Promise<MinkSexStock> {
  const lots = await loadFurLots(prisma, orgId, { kind: "fur", year: "all" });
  let M = 0, F = 0;
  for (const l of lots) {
    if (l.item !== "Норка" || l.purchaseStatus === "DRAFT" || l.purchaseStatus === "CANCELLED" || !(l.rem > 0)) continue;
    const s = sexOf(l.lotNumber);
    if (s === "M") M += l.rem; else if (s === "F") F += l.rem;
  }
  return { M, F, U: Math.max(0, total - M - F) };
}
