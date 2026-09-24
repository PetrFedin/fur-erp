import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createPurchase } from "../actions";
import { PurchaseCreateForm } from "./form";

export default async function NewPurchasePage() {
  const session = await requireSession();
  const [suppliers, warehouses] = await Promise.all([
    prisma.supplier.findMany({
      where: { organizationId: session.user.organizationId, isActive: true },
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
          <CardTitle>Новая закупка сырья</CardTitle>
        </CardHeader>
        <CardContent>
          <PurchaseCreateForm action={createPurchase} suppliers={suppliers} warehouses={warehouses} />
        </CardContent>
      </Card>
    </div>
  );
}
