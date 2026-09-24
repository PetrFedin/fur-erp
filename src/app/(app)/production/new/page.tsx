import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createProductionOrder } from "../actions";
import { ProductionCreateForm } from "./form";

export default async function NewProductionOrderPage() {
  const session = await requireSession();
  const [models, warehouses] = await Promise.all([
    prisma.productModel.findMany({
      where: { organizationId: session.user.organizationId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.warehouse.findMany({
      where: { organizationId: session.user.organizationId },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Новый производственный заказ</CardTitle>
        </CardHeader>
        <CardContent>
          <ProductionCreateForm action={createProductionOrder} models={models} warehouses={warehouses} />
        </CardContent>
      </Card>
    </div>
  );
}
