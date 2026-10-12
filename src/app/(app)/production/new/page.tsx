import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { createProductionOrder } from "../actions";
import { ProductionCreateForm } from "./form";
import type { LotOpt } from "./lot-picker";
import { canEditProduction } from "@/lib/production-access";
import { getColorOptions } from "@/lib/colors";
import { ACCESS, hasRole } from "@/lib/access";
import { lotUnitCostExclVat } from "@/lib/purchase-totals";
import { batchLabel } from "@/lib/batch-label";

export const metadata = { title: "Новое ТЗ" };

export default async function NewProductionOrderPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const articleParam = Array.isArray(sp.article) ? sp.article[0] : sp.article;
  const session = await requireSession();
  if (!canEditProduction(session.user.role)) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">Новое ТЗ</h1>
        <p className="text-sm text-neutral-600">Недостаточно прав для создания ТЗ. Обратитесь к владельцу, администратору или технологу.</p>
      </div>
    );
  }
  const orgId = session.user.organizationId;
  const [models, warehouses, clients, lots, contractRows, batches, expenseCategories, furs, colorOptions] = await Promise.all([
    prisma.productModel.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, name: true, sellingPrice: true, category: true, categoryRef: { select: { group: true } } },
    }),
    prisma.warehouse.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } }),
    prisma.client.findMany({ where: { organizationId: orgId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.rawMaterialLot.findMany({
      where: { organizationId: orgId, quantityRemaining: { gt: 0 } },
      include: { rawMaterial: { select: { name: true, unit: true } }, purchase: { select: { id: true, number: true, auction: { select: { name: true } } } } },
      orderBy: [{ receivedDate: "desc" }],
    }),
    prisma.productionOrder.findMany({
      where: { organizationId: orgId, clientId: { not: null }, contractNumber: { not: null } },
      select: { clientId: true, contractNumber: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.productionBatch.findMany({
      where: { organizationId: orgId },
      orderBy: { number: "desc" },
      select: { id: true, number: true, year: true, orders: { select: { workOrderDate: true, endDate: true, startDate: true } } },
    }),
    prisma.expenseCategory.findMany({ where: { organizationId: orgId, kind: "PRODUCTION", isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.furRef.findMany({ where: { organizationId: orgId }, select: { name: true }, orderBy: { name: "asc" } }),
    getColorOptions(orgId),
  ]);

  // Последний договор заказчика — только подсказка, правится в форме.
  const lastContractByClient: Record<string, string> = {};
  for (const r of contractRows) {
    if (r.clientId && r.contractNumber && !(r.clientId in lastContractByClient)) lastContractByClient[r.clientId] = r.contractNumber;
  }

  const lotOpts: LotOpt[] = lots.map((l) => ({
    id: l.id,
    lotNumber: l.lotNumber,
    material: l.rawMaterial.name,
    unit: l.rawMaterial.unit,
    grade: l.grade,
    color: l.color,
    remaining: Number(l.quantityRemaining),
    unitCost: Number(l.unitCost),
    unitCostExcl: Number(lotUnitCostExclVat(l)),
    vatRate: Number(l.vatRate),
    purchaseId: l.purchase?.id ?? null,
    purchaseNumber: l.purchase?.number ?? null,
    auction: l.purchase?.auction?.name ?? null,
  }));

  return (
    <ProductionCreateForm
      action={createProductionOrder}
      initialArticleId={articleParam && models.some((m) => m.id === articleParam) ? articleParam : ""}
      models={models.map((m) => ({ id: m.id, name: m.name, retailPrice: m.sellingPrice?.toString() ?? null, category: m.category ?? null, group: m.categoryRef?.group ?? null }))}
      warehouses={warehouses.map((w) => ({ id: w.id, name: w.name, isDefault: w.isDefault }))}
      clients={clients}
      lots={lotOpts}
      lastContractByClient={lastContractByClient}
      colorOptions={colorOptions}
      canAddColor={hasRole(session.user.role, ACCESS.colors)}
      canAddFur={hasRole(session.user.role, ACCESS.furRefs)}
      batches={batches.map((b) => ({ id: b.id, number: b.number, label: batchLabel(b.number, b.year, b.orders) }))}
      expenseCategories={expenseCategories}
      furs={furs.map((f) => f.name)}
    />
  );
}
