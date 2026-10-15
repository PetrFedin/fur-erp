import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { ACCESS, hasRole } from "@/lib/access";
import { createPurchase } from "../actions";
import { PurchaseCreateForm } from "./form";

export const metadata = { title: "Новая закупка" };

export default async function NewPurchasePage() {
  const session = await requireSession();
  const [suppliers, materials, lots, auctions] = await Promise.all([
    prisma.supplier.findMany({
      where: { organizationId: session.user.organizationId, isActive: true },
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
    <div className="flex flex-col gap-3">
      <Breadcrumbs items={[{ label: "Сырьё", href: "/lots" }, { label: "Закупки", href: "/purchases" }, { label: "Новая закупка" }]} />
      <h1 className="text-xl font-semibold">Новая закупка</h1>
      <p className="rounded-lg bg-[var(--ui-soft)] px-3 py-2 text-sm text-neutral-900">
        Нужны лоты из Excel, расходы и состав цены до сохранения? Откройте единое окно:{" "}
        <Link href="/purchases/batch" className="font-medium underline">Закупка меха →</Link>
      </p>
      <Card>
        <CardContent className="pt-4">
          <PurchaseCreateForm
            action={createPurchase}
            suppliers={suppliers}
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
