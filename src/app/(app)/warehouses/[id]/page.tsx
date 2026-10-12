import { Breadcrumbs } from "@/components/breadcrumbs";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WarehouseForm } from "../warehouse-form";
import { updateWarehouse } from "../actions";

export default async function EditWarehousePage({ params }: PageProps<"/warehouses/[id]">) {
  const { id } = await params;
  const session = await requireSession();
  const warehouse = await prisma.warehouse.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!warehouse) notFound();

  return (
    <div className="max-w-md">
      <Breadcrumbs items={[{ label: "Настройки", href: "/settings" }, { label: "Склады", href: "/warehouses" }, { label: warehouse.name }]} className="mb-3" />
      <Card>
        <CardHeader>
          <CardTitle as="h1" className="text-xl">Редактировать склад</CardTitle>
        </CardHeader>
        <CardContent>
          <WarehouseForm action={updateWarehouse.bind(null, id)} warehouse={warehouse} />
        </CardContent>
      </Card>
    </div>
  );
}
