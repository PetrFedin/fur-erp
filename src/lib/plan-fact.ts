import { producedUnits } from "@/lib/production-totals";
import "server-only";
import { prisma } from "@/lib/prisma";
import { normalizeModelCode } from "@/lib/model-code";
import { normalizeSize, SIZE_ONE, SIZE_CM, SIZE_SET, UNDEFINED_SIZE } from "@/lib/product-category";
import { colorKey } from "@/lib/color-ref";
import { cleanSize } from "@/lib/plan-sizes";
import { articleLabel } from "@/lib/article-label";

// Факт по плану: сколько единиц по ТЗ этого артикула (в сезоне плана) уже произведено, в работе, не начато.
// ТЗ → артикул по ProductModel (productModelId); позиция плана → ProductModel по modelId либо по написанию кода
// (название, артикул, код продаж, синонимы; латиница и кириллица считаются одинаковыми).
// Единицы по размерам ТЗ: размер записан одним значением («46») — относим к нему; «единый», «44, 46», пусто —
// в «набор размеров» (разбить нельзя: числа по размерам в ТЗ нет).

export const SET_BUCKET = "набор размеров";

export type FactOrder = {
  id: string;
  label: string;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED";
  planned: number;
  produced: number;
  size: string | null;
  seasonId: string | null;
};

export type PlanFact = {
  modelId: string | null;
  produced: number;
  inWork: number;
  notStarted: number;
  producedBySize: Record<string, number>;
  orders: FactOrder[];
  /** ТЗ этого артикула без сезона — их можно присвоить на странице «Сезоны ТЗ». */
  unseasoned: number;
};

type PlanKey = { id: string; seasonId: string | null; modelId: string | null; articleCode: string; color: string | null };
export type ModelKey = { id: string; name: string; sku: string | null; salesCode: string | null; aliases: string[] };

const k = (s: string | null | undefined) => normalizeModelCode((s ?? "").trim()).toLowerCase();

export function modelIndex(models: ModelKey[]): Map<string, string> {
  const m = new Map<string, string>();
  // Сначала названия, чтобы они не перекрывались синонимами других моделей.
  for (const md of models) if (k(md.name)) m.set(k(md.name), md.id);
  for (const md of models) for (const v of [md.sku, md.salesCode, ...md.aliases]) if (k(v) && !m.has(k(v))) m.set(k(v), md.id);
  return m;
}

export function resolveModelId(p: { modelId: string | null; articleCode: string }, idx: Map<string, string>): string | null {
  return p.modelId ?? idx.get(k(p.articleCode)) ?? null;
}

function sizeBucket(raw: string | null): string {
  const n = normalizeSize(raw);
  if (n === SIZE_ONE || n === SIZE_CM || n === SIZE_SET || n === UNDEFINED_SIZE) return SET_BUCKET;
  return cleanSize(n);
}

export async function loadPlanFacts(organizationId: string, plans: PlanKey[], models: ModelKey[]): Promise<Map<string, PlanFact>> {
  const idx = modelIndex(models);
  const modelOf = new Map(plans.map((p) => [p.id, resolveModelId(p, idx)]));
  const modelIds = [...new Set([...modelOf.values()].filter((x): x is string => !!x))];
  const orders = modelIds.length
    ? await prisma.productionOrder.findMany({
        where: { organizationId, productModelId: { in: modelIds }, status: { not: "CANCELLED" } },
        select: { id: true, number: true, workOrderNumber: true, status: true, plannedQuantity: true, producedQuantity: true, size: true, color: true, seasonId: true, productModelId: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  // Позиции с одним артикулом в одном сезоне делят ТЗ: по цвету, иначе — первой позиции группы.
  const groups = new Map<string, PlanKey[]>();
  for (const p of plans) {
    const mid = modelOf.get(p.id);
    if (!mid) continue;
    const g = `${mid}|${p.seasonId ?? ""}`;
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }

  const result = new Map<string, PlanFact>();
  for (const p of plans) {
    result.set(p.id, { modelId: modelOf.get(p.id) ?? null, produced: 0, inWork: 0, notStarted: 0, producedBySize: {}, orders: [], unseasoned: 0 });
  }
  const seen = new Set<string>();
  for (const p of plans) {
    const mid = modelOf.get(p.id);
    if (!mid) continue;
    const gkey = `${mid}|${p.seasonId ?? ""}`;
    if (seen.has(gkey)) continue;
    seen.add(gkey);
    const group = groups.get(gkey)!;
    const unseasoned = orders.filter((o) => o.productModelId === mid && o.seasonId === null).length;
    for (const o of orders) {
      if (o.productModelId !== mid || o.seasonId !== p.seasonId) continue;
      let target = group[0];
      if (group.length > 1) {
        const oc = colorKey(o.color);
        target = group.find((g) => g.color && colorKey(g.color) === oc) ?? group.find((g) => !g.color) ?? group[0];
      }
      const f = result.get(target.id)!;
      const planned = Number(o.plannedQuantity);
      const produced = producedUnits(o);
      const fo: FactOrder = {
        id: o.id,
        label: o.workOrderNumber ? `ТЗ №${o.workOrderNumber}` : `Заказ ${o.number}`,
        status: o.status as FactOrder["status"],
        planned,
        produced,
        size: o.size,
        seasonId: o.seasonId,
      };
      f.orders.push(fo);
      f.produced += produced;
      if (produced > 0) {
        const b = sizeBucket(o.size);
        f.producedBySize[b] = (f.producedBySize[b] ?? 0) + produced;
      }
      if (o.status === "IN_PROGRESS") f.inWork += Math.max(0, planned - produced);
      else if (o.status === "PLANNED") f.notStarted += planned;
    }
    for (const g of group) result.get(g.id)!.unseasoned = unseasoned;
  }
  return result;
}

/** ТЗ сезона, артикулов которых нет в плане сезона («вне плана»). */
export async function loadOffPlan(organizationId: string, seasonId: string, planModelIds: string[]) {
  const orders = await prisma.productionOrder.findMany({
    where: { organizationId, seasonId, status: { not: "CANCELLED" }, productModelId: { notIn: planModelIds } },
    select: { id: true, workOrderNumber: true, number: true, status: true, producedQuantity: true, plannedQuantity: true, productModel: { select: { name: true, category: true, salesCode: true, salesName: true } } },
  });
  return orders.map((o) => ({
    id: o.id,
    label: o.workOrderNumber ? `ТЗ №${o.workOrderNumber}` : `Заказ ${o.number}`,
    model: articleLabel(o.productModel),
    produced: producedUnits(o),
    planned: Number(o.plannedQuantity),
  }));
}
