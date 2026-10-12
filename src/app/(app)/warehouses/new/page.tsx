import { Breadcrumbs } from "@/components/breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WarehouseForm } from "../warehouse-form";
import { createWarehouse } from "../actions";

export default function NewWarehousePage() {
  return (
    <div className="max-w-md">
      <Breadcrumbs items={[{ label: "Настройки", href: "/settings" }, { label: "Склады", href: "/warehouses" }, { label: "Новый склад" }]} className="mb-3" />
      <Card>
        <CardHeader>
          <CardTitle as="h1" className="text-xl">Новый склад</CardTitle>
        </CardHeader>
        <CardContent>
          <WarehouseForm action={createWarehouse} />
        </CardContent>
      </Card>
    </div>
  );
}
