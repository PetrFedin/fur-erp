import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Decimal } from "@prisma/client/runtime/library";
import { createProductionOrder } from "../actions";
import { ProductionCreateForm } from "./form";

export default async function NewProductionOrderPage() {
  const session = await requireSession();
  const [models, warehouses, clients, liningMaterials, liningLots, contractRows] = await Promise.all([
    prisma.productModel.findMany({
      where: { organizationId: session.user.organizationId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.warehouse.findMany({
      where: { organizationId: session.user.organizationId },
      orderBy: { name: "asc" },
    }),
    prisma.client.findMany({
      where: { organizationId: session.user.organizationId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.rawMaterial.findMany({
      where: { organizationId: session.user.organizationId, unit: "M" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.rawMaterialLot.findMany({
      where: { organizationId: session.user.organizationId, rawMaterial: { unit: "M" } },
      select: { rawMaterialId: true, quantityRemaining: true },
    }),
    prisma.productionOrder.findMany({
      where: { organizationId: session.user.organizationId, clientId: { not: null }, contractNumber: { not: null } },
      select: { clientId: true, contractNumber: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Latest contract per client — only a pre-filled hint, editable in the form.
  const lastContractByClient: Record<string, string> = {};
  for (const r of contractRows) {
    if (r.clientId && r.contractNumber && !(r.clientId in lastContractByClient)) {
      lastContractByClient[r.clientId] = r.contractNumber;
    }
  }

  const remainingByMaterial = new Map<string, Decimal>();
  for (const l of liningLots) {
    remainingByMaterial.set(
      l.rawMaterialId,
      (remainingByMaterial.get(l.rawMaterialId) ?? new Decimal(0)).add(l.quantityRemaining)
    );
  }
  const liningOptions = liningMaterials.map((m) => ({
    id: m.id,
    name: m.name,
    remaining: (remainingByMaterial.get(m.id) ?? new Decimal(0)).toString(),
  }));

  return (
    <div className="max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>Новое ТЗ</CardTitle>
        </CardHeader>
        <CardContent>
          <ProductionCreateForm
            action={createProductionOrder}
            models={models}
            warehouses={warehouses}
            clients={clients}
            liningOptions={liningOptions}
            lastContractByClient={lastContractByClient}
          />
        </CardContent>
      </Card>
    </div>
  );
}
