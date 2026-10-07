import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ACCESS, hasRole } from "@/lib/access";
import { createPurchase } from "../actions";
import { PurchaseCreateForm } from "./form";

export default async function NewPurchasePage() {
  const session = await requireSession();
  const [suppliers, warehouses, materials, lots, auctions] = await Promise.all([
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
    prisma.rawMaterialLot.findMany({
      where: { organizationId: session.user.organizationId, lotNumber: { not: null } },
      select: { lotNumber: true },
    }),
    prisma.auction.findMany({
      where: { organizationId: session.user.organizationId, isService: false },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, fullName: true, house: true, year: true, aliases: true },
    }),
  ]);

  return (
    <div className="flex max-w-4xl flex-col gap-3">
      <div className="text-sm"><Link href="/purchases" className="text-neutral-500 hover:underline">← Закупки</Link></div>
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
            existingLotNumbers={lots.map((l) => l.lotNumber as string)}
            auctions={auctions}
            canCreateAuction={hasRole(session.user.role, ACCESS.auctions)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
