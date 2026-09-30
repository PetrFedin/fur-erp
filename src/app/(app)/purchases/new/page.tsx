import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createPurchase } from "../actions";
import { PurchaseCreateForm } from "./form";

export default async function NewPurchasePage() {
  const session = await requireSession();
  const [suppliers, warehouses, materials] = await Promise.all([
    prisma.supplier.findMany({
      where: { organizationId: session.user.organizationId, isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.warehouse.findMany({
      where: { organizationId: session.user.organizationId },
      orderBy: { name: "asc" },
    }),
    prisma.rawMaterial.findMany({
      where: { organizationId: session.user.organizationId },
      select: { name: true },
    }),
  ]);

  return (
    <div className="max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle>Новая закупка</CardTitle>
        </CardHeader>
        <CardContent>
          <PurchaseCreateForm
            action={createPurchase}
            suppliers={suppliers}
            warehouses={warehouses}
            materialNames={materials.map((m) => m.name)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
