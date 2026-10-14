import "server-only";
import { prisma } from "@/lib/prisma";
import { canonicalFur, type FurIndex } from "@/lib/fur-ref";
import { getFurIndex } from "@/lib/fur-ref-server";
import { furFromText } from "@/lib/product-category";
import { furKindsOfOrder } from "@/lib/order-fur";

/**
 * Упрощённый «Тип меха» артикула (вычисляется, в базе не хранится). Правило:
 * 1) по ТЗ артикула: ручной вид ТЗ (furTypeOverride) или сырьё из списаний (через справочник меха) — самый частый вид среди ТЗ;
 * 2) нет списаний — по тексту «Материал» ТЗ, затем по названию/описанию/категории артикула («из соболя», «норки», «свакара»…);
 * 3) иначе пусто. Денежных данных не читает — безопасно и для кабинета поставщика.
 */
const kindOf = (t: string | null | undefined, idx: FurIndex | undefined) => canonicalFur(t, idx)?.name ?? furFromText(t);

/** Самый частый вид; при равенстве — все лидеры через « + » («Норка + Соболь»). */
function top(counts: Map<string, number>): string | null {
  const max = Math.max(0, ...counts.values());
  if (!max) return null;
  return Array.from(counts).filter(([, n]) => n === max).map(([k]) => k).sort((a, b) => a.localeCompare(b, "ru")).join(" + ");
}

export async function loadArticleFurTypes(orgId: string): Promise<Map<string, { fur: string; source: "tz" | "text" }>> {
  const idx = await getFurIndex(orgId);
  const models = await prisma.productModel.findMany({
    where: { organizationId: orgId },
    select: {
      id: true, category: true, salesName: true, description: true,
      productionOrders: {
        where: { status: { not: "CANCELLED" } },
        select: { furTypeOverride: true, materialDescription: true, materialUsages: { select: { rawMaterial: { select: { name: true, unit: true } } } } },
      },
    },
  });
  const out = new Map<string, { fur: string; source: "tz" | "text" }>();
  for (const m of models) {
    const fromLots = new Map<string, number>();
    const fromMat = new Map<string, number>();
    for (const o of m.productionOrders) {
      const kinds = new Set<string>();
      const ov = o.furTypeOverride?.trim();
      if (ov) furKindsOfOrder(ov).forEach((k) => kinds.add(k));
      else for (const u of o.materialUsages) if (u.rawMaterial.unit !== "M") kinds.add(canonicalFur(u.rawMaterial.name, idx)?.name ?? u.rawMaterial.name);
      kinds.forEach((k) => fromLots.set(k, (fromLots.get(k) ?? 0) + 1));
      const t = kindOf(o.materialDescription, idx);
      if (t) fromMat.set(t, (fromMat.get(t) ?? 0) + 1);
    }
    const lots = top(fromLots);
    if (lots) { out.set(m.id, { fur: lots, source: "tz" }); continue; }
    const mat = top(fromMat) ?? kindOf(m.salesName, idx) ?? kindOf(m.description?.split("\n")[0], idx) ?? kindOf(m.category, idx);
    if (mat) out.set(m.id, { fur: mat, source: "text" });
  }
  return out;
}
