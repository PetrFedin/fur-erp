import "server-only";
// ЧЕРНОВИК единой точки «после правки»: что пересчитать и что сбросить, когда изменилась запись.
// НЕ ПОДКЛЮЧЁН к формам (решение: сначала согласовать список, docs/analysis/dependencies.md). Пока каждый server action сам вызывает
// revalidatePath / resetBy* / invalidate*, и часть связей теряется. Идея: в конце действия — одна строка
//   await recalcAfterEdit("purchaseItem", itemId, { orgId, purchaseId });
// вместо россыпи revalidatePath и сброса кэшей. Снимки (totalCost ТЗ, стоимость лота) по-прежнему пересчитывают сами действия
// в своей транзакции (syncCompletedOrderCost и т. п.) — здесь только то, что СНАРУЖИ транзакции: страницы, кэши, подтверждения.
import { revalidatePath } from "next/cache";
import { invalidateControlCounts } from "@/lib/control-counts";
import { invalidateFilterOptions } from "@/lib/filter-options";
import { invalidateIntegrity } from "./run";
import { resetByBatch, resetByOrder, resetByProdPayment, resetByPurchase, resetVerification } from "@/lib/verification";
import { prisma } from "@/lib/prisma";

export type RecalcEntity =
  | "purchase" | "purchaseItem" | "purchaseExpense" | "purchasePayment" | "auctionPayment"
  | "lot"
  | "order" | "orderUsage" | "orderExpense" | "orderColors"
  | "prodPayment" | "batch"
  | "model" | "colorRef" | "categoryRef" | "auction" | "supplier" | "client";

export type RecalcCtx = {
  orgId: string;
  /** Для строк закупки/расходов/оплат/лота — id закупки; для списаний и расходов ТЗ — id ТЗ; для оплат производства — id ТЗ (orderIds). */
  purchaseId?: string | null;
  orderId?: string | null;
  orderIds?: string[];
  batchId?: string | null;
  batchNumber?: number | null;
  auctions?: (string | null | undefined)[];
  /** Не сбрасывать «подтверждено» (только для правок, не меняющих сведённые числа). */
  keepVerification?: boolean;
};

/** Страницы, показывающие производные числа сущности (одна таблица вместо россыпи revalidatePath в действиях). */
export const DEPENDENT_PATHS: Record<RecalcEntity, (id: string, c: RecalcCtx) => string[]> = {
  purchase: (id) => [`/purchases/${id}`, "/purchases", "/lots", "/lining", "/payments", "/dashboard", "/analytics/raw", "/verify", "/documents", "/reconciliation", "/integrity"],
  purchaseItem: (_id, c) => [`/purchases/${c.purchaseId}`, "/purchases", "/lots", "/lining", "/payments", "/dashboard", "/analytics/raw", "/verify", "/reconciliation", "/integrity"],
  purchaseExpense: (_id, c) => [`/purchases/${c.purchaseId}`, "/purchases", "/lots", "/payments", "/dashboard", "/analytics/raw", "/verify", "/integrity"],
  purchasePayment: (_id, c) => [`/purchases/${c.purchaseId}`, "/purchases", "/payments", "/dashboard", "/verify", "/documents", "/reconciliation", "/integrity"],
  auctionPayment: () => ["/payments", "/lots", "/purchases", "/dashboard", "/verify", "/documents", "/reconciliation", "/integrity"],
  lot: (id, c) => [`/analytics/raw/lot/${id}`, ...(c.purchaseId ? [`/purchases/${c.purchaseId}`] : []), "/lots", "/lining", "/analytics/raw", "/production", "/dashboard", "/integrity"],
  order: (id) => [`/production/${id}`, "/production", "/production/batches", "/articles", "/finished-stock", "/payments", "/dashboard", "/plan", "/calendar", "/verify", "/attention", "/documents", "/analytics/products", "/integrity"],
  orderUsage: (_id, c) => [`/production/${c.orderId}`, "/production", "/production/batches", "/lots", "/lining", "/analytics/raw", "/articles", "/dashboard", "/verify", "/integrity"],
  orderExpense: (_id, c) => [`/production/${c.orderId}`, "/production", "/production/batches", "/articles", "/dashboard", "/verify", "/integrity"],
  orderColors: (_id, c) => [`/production/${c.orderId}`, "/production", "/dashboard", "/integrity"],
  prodPayment: (_id, c) => [...(c.orderIds ?? []).map((x) => `/production/${x}`), "/production", "/production/batches", "/payments", "/dashboard", "/verify", "/documents", "/integrity"],
  batch: (_id, c) => [...(c.batchNumber != null ? [`/production/batches/${c.batchNumber}`] : []), "/production", "/production/batches", "/payments", "/dashboard", "/verify", "/documents", "/analytics/products", "/integrity"],
  model: (id) => [`/models/${id}`, "/articles", "/production", "/dashboard", "/finished-stock", "/integrity"],
  colorRef: () => ["/settings/colors", "/lots", "/lining", "/production", "/purchases", "/analytics/raw", "/dashboard", "/integrity"],
  categoryRef: () => ["/settings/categories", "/articles", "/production", "/dashboard", "/integrity"],
  auction: () => ["/settings/auctions", "/purchases", "/lots", "/payments", "/dashboard", "/verify", "/reconciliation", "/integrity"],
  supplier: () => ["/suppliers", "/purchases", "/payments", "/dashboard", "/integrity"],
  client: () => ["/clients", "/production", "/payments", "/dashboard", "/integrity"],
};

/** Какие сущности меняют варианты фильтров (кэш 30 с) — сбрасываем кэш вариантов только для них. */
const FILTER_ENTITIES: ReadonlySet<RecalcEntity> = new Set(["purchase", "lot", "order", "batch", "model", "colorRef", "categoryRef", "auction", "supplier", "client"]);

export type RecalcResult = { paths: string[]; caches: string[]; verificationReset: boolean };

/**
 * Единая точка после правки. Вызывать ПОСЛЕ успешной транзакции. Делает три вещи:
 *  1) revalidatePath всех страниц, где видны производные числа записи (DEPENDENT_PATHS);
 *  2) сбрасывает кэши в памяти: счётчики «Контроля», варианты фильтров, самопроверка;
 *  3) сбрасывает «подтверждено» у затронутых закупок/ТЗ/партий/оплат (если не keepVerification).
 * Ошибки сброса подтверждения не ломают действие (как и в resetBy*).
 */
export async function recalcAfterEdit(entity: RecalcEntity, id: string, ctx: RecalcCtx): Promise<RecalcResult> {
  const paths = [...new Set(DEPENDENT_PATHS[entity](id, ctx))];
  for (const p of paths) revalidatePath(p);
  const caches = ["control-counts", "integrity"];
  invalidateControlCounts(ctx.orgId);
  invalidateIntegrity(ctx.orgId);
  if (FILTER_ENTITIES.has(entity)) {
    invalidateFilterOptions(ctx.orgId);
    caches.push("filter-options");
  }
  let verificationReset = false;
  if (!ctx.keepVerification) {
    switch (entity) {
      case "purchase": case "purchaseItem": case "purchaseExpense": case "lot":
        if (ctx.purchaseId ?? (entity === "purchase" ? id : null)) await resetByPurchase(ctx.purchaseId ?? id);
        verificationReset = true;
        break;
      case "purchasePayment": case "auctionPayment":
        await resetVerification(prisma, ctx.orgId, { purchaseIds: ctx.purchaseId ? [ctx.purchaseId] : [], auctions: ctx.auctions ?? [], paymentIds: [id] });
        verificationReset = true;
        break;
      case "order": case "orderUsage": case "orderExpense": case "orderColors":
        await resetByOrder(ctx.orderId ?? id);
        verificationReset = true;
        break;
      case "prodPayment":
        await resetByProdPayment(ctx.orgId, id, ctx.orderIds);
        verificationReset = true;
        break;
      case "batch":
        await resetByBatch(ctx.orgId, ctx.batchId ?? id);
        verificationReset = true;
        break;
      default:
        break;
    }
  }
  return { paths, caches, verificationReset };
}
