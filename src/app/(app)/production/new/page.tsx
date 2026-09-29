import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Decimal } from "@prisma/client/runtime/library";
import { createProductionOrder } from "../actions";
import { ProductionCreateForm } from "./form";

export default async function NewProductionOrderPage() {
  const session = await requireSession();
  const [models, warehouses, clients, liningMaterials, liningLots] = await Promise.all([
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
  ]);

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
    <div className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Новый производственный заказ</CardTitle>
        </CardHeader>
        <CardContent>
          <ProductionCreateForm
            action={createProductionOrder}
            models={models}
            warehouses={warehouses}
            clients={clients}
            liningOptions={liningOptions}
          />
        </CardContent>
      </Card>
    </div>
  );
}
