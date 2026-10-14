import Link from "next/link";
import { STEPS } from "./data";
import { SchemeDiagram } from "./diagram";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Схема работы" };

export default async function SchemePage() {
  const session = await requireSession();
  const org = session.user.organizationId;
  const [purchase, lot, order, batch, payment, paymentProd, shipment, model, fitting, budget, supplier] = await Promise.all([
    prisma.purchase.findFirst({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    prisma.rawMaterialLot.findFirst({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    prisma.productionOrder.findFirst({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    prisma.productionBatch.findFirst({ where: { organizationId: org }, orderBy: { number: "desc" }, select: { number: true } }),
    prisma.payment.findFirst({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    prisma.productionPayment.findFirst({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    prisma.shipment.findFirst({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    prisma.productModel.findFirst({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    prisma.fitting.findFirst({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    prisma.budgetScenario.findFirst({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    prisma.supplier.findFirst({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, select: { id: true } }),
  ]);
  const cards = {
    purchase: purchase && `/purchases/${purchase.id}`,
    lot: lot && `/analytics/raw/lot/${lot.id}`,
    order: order && `/production/${order.id}`,
    batch: batch && `/production/batches/${batch.number}`,
    payment: payment && `/payments/s-${payment.id}`,
    paymentProd: paymentProd && `/payments/c-${paymentProd.id}`,
    shipment: shipment && `/shipments/${shipment.id}`,
    model: model && `/models/${model.id}`,
    fitting: fitting && `/fittings/${fitting.id}`,
    budget: budget && `/budget/${budget.id}`,
    supplier: supplier && `/suppliers/${supplier.id}`,
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Схема работы</h1>
        <Link href="/dashboard" className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-50">← Главная</Link>
      </div>

      <SchemeDiagram steps={STEPS} cards={Object.fromEntries(Object.entries(cards).filter(([, v]) => v)) as never} />
    </div>
  );
}
