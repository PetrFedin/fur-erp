import "server-only";
// Загрузка цепочки готовой продукции (finished-chain.ts): ТЗ, отгрузки и приёмка, строки поступлений/продаж выгрузки.
import { prisma } from "@/lib/prisma";
import { isRepairOrder } from "@/lib/batch-stats";
import { producedUnits, inWorkUnits } from "@/lib/production-totals";
import { finishedChain, closeByAcceptance, type Chain, type CloseVerdict } from "@/lib/finished-chain";

export type ChainData = { chain: Chain; inWork: number; closeCandidates: CloseVerdict[] };

export async function loadFinishedChain(orgId: string): Promise<ChainData> {
  const [orders, lines, sales] = await Promise.all([
    prisma.productionOrder.findMany({
      where: { organizationId: orgId, status: { not: "CANCELLED" } },
      select: { id: true, number: true, workOrderNumber: true, status: true, plannedQuantity: true, producedQuantity: true, materialDescription: true, productModel: { select: { name: true, category: true, categoryRef: { select: { name: true } } } } },
    }),
    prisma.shipmentLine.findMany({
      where: { shipment: { organizationId: orgId, status: { in: ["SHIPPED", "ACCEPTED"] } } },
      select: { productionOrderId: true, quantity: true, acceptedQty: true, returnedQty: true, shipment: { select: { status: true } } },
    }),
    prisma.salesReceiptLine.groupBy({ by: ["kind"], where: { organizationId: orgId }, _sum: { pcs: true } }).catch(() => [] as { kind: string; _sum: { pcs: number | null } }[]),
  ]);
  const real = orders.filter((o) => !isRepairOrder(o));
  const produced = real.reduce((a, o) => a + producedUnits(o), 0), inWork = real.reduce((a, o) => a + inWorkUnits(o), 0);
  let shipped = 0, accepted = 0;
  const per = new Map<string, { accepted: number; returned: number; sentNotAccepted: number }>();
  for (const l of lines) {
    const ret = l.returnedQty ?? 0;
    shipped += l.quantity - ret;
    const acc = l.shipment.status === "ACCEPTED" ? l.acceptedQty ?? 0 : 0;
    accepted += acc;
    if (l.productionOrderId) {
      const e = per.get(l.productionOrderId) ?? { accepted: 0, returned: 0, sentNotAccepted: 0 };
      e.accepted += acc; e.returned += ret; e.sentNotAccepted += Math.max(0, l.quantity - ret - acc);
      per.set(l.productionOrderId, e);
    }
  }
  const sum = (k: string) => Number(sales.find((s) => s.kind === k)?._sum.pcs ?? 0);
  const chain = finishedChain({ produced, shipped, accepted, storeReceived: sum("RECEIPT"), sold: sum("SALE") });
  const closeCandidates = real
    .map((o) => { const e = per.get(o.id); return e ? closeByAcceptance({ number: o.workOrderNumber ?? o.number, status: o.status, planned: Number(o.plannedQuantity), accepted: e.accepted, returned: e.returned, shippedNotAccepted: e.sentNotAccepted }) : null; })
    .filter((v): v is CloseVerdict => !!v && v.verdict !== "skip");
  return { chain, inWork, closeCandidates };
}
