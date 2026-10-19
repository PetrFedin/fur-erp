import "server-only";
// Загрузка данных раздела Cashflow: доля НДС закупок, состав «Услуг по УПД», строки поступлений и продаж (если выгрузка загружена).
import { prisma } from "@/lib/prisma";
import type { OverviewRow } from "@/lib/payments-overview";
import type { SalesAggLine } from "@/lib/sales-receipts-core";

/** Доля НДС в сумме закупки (по позициям: Σ база·ставка / Σ база·(1+ставка); у закупок-услуг без позиций — по расходам). */
export async function loadPurchaseVat(orgId: string): Promise<Map<string, number>> {
  const [items, exps] = await Promise.all([
    prisma.purchaseItem.findMany({ where: { purchase: { organizationId: orgId } }, select: { purchaseId: true, subtotal: true, vatRate: true } }),
    prisma.purchaseExpense.findMany({ where: { purchase: { organizationId: orgId } }, select: { purchaseId: true, amount: true, vatRate: true } }),
  ]);
  const base = new Map<string, number>(), vat = new Map<string, number>();
  const add = (id: string, b: number, r: number) => { base.set(id, (base.get(id) ?? 0) + b); vat.set(id, (vat.get(id) ?? 0) + (b * r) / 100); };
  const hasItems = new Set(items.map((i) => i.purchaseId));
  for (const i of items) add(i.purchaseId, i.subtotal.toNumber(), i.vatRate.toNumber());
  for (const e of exps) if (!hasItems.has(e.purchaseId)) add(e.purchaseId, e.amount.toNumber(), e.vatRate.toNumber());
  const out = new Map<string, number>();
  for (const [id, b] of base) { const v = vat.get(id) ?? 0; if (b + v > 0) out.set(id, v / (b + v)); }
  return out;
}

export type ServicePart = { number: string; what: string; invoice: string | null; date: string; paid: number };

/** Состав статьи «Услуги по УПД»: закупки, по которым были платежи этой статьи, с описанием из расходов закупки. */
export async function loadServiceParts(orgId: string, rows: OverviewRow[]): Promise<ServicePart[]> {
  const paid = new Map<string, number>();
  for (const r of rows) {
    if (r.kind !== "raw" || r.services <= 0.005) continue;
    for (const p of r.parts) {
      const id = p.href?.startsWith("/purchases/") ? p.href.slice("/purchases/".length) : null;
      if (id) paid.set(id, (paid.get(id) ?? 0) + (p.amount * r.services) / (r.amount || 1));
    }
  }
  if (!paid.size) return [];
  const ps = await prisma.purchase.findMany({
    where: { organizationId: orgId, id: { in: [...paid.keys()] } },
    select: { id: true, number: true, invoiceNumber: true, orderDate: true, expenses: { select: { description: true } } },
    orderBy: { number: "asc" },
  });
  return ps.map((p) => ({
    number: p.number, invoice: p.invoiceNumber, date: p.orderDate.toISOString().slice(0, 10), paid: paid.get(p.id) ?? 0,
    what: (p.expenses.map((e) => e.description).find(Boolean) ?? "услуги по УПД").replace(/;?\s*УПД №.*$/i, "").trim(),
  }));
}

/** Строки поступлений/продаж. Нет таблицы (миграция не применена) или нет строк — пусто: раздел показывает «нет данных о продажах». */
export async function loadSalesLines(orgId: string): Promise<SalesAggLine[]> {
  try {
    const rows = await prisma.salesReceiptLine.findMany({
      where: { organizationId: orgId },
      select: { kind: true, date: true, pcs: true, retailRub: true, retailRubExVat: true, discountRub: true },
    });
    return rows.map((r) => ({ kind: r.kind, iso: r.date.toISOString().slice(0, 10), pcs: r.pcs ?? 0, retailRub: r.retailRub?.toNumber() ?? 0, retailRubExVat: r.retailRubExVat?.toNumber() ?? 0, discountRub: r.discountRub?.toNumber() ?? 0 }));
  } catch {
    return [];
  }
}
