import { Breadcrumbs } from "@/components/breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SupplierForm } from "../supplier-form";
import { createSupplier } from "../actions";

export default function NewSupplierPage() {
  return (
    <div className="flex flex-col gap-3">
      <Breadcrumbs items={[{ label: "Настройки", href: "/settings" }, { label: "Поставщики", href: "/suppliers" }, { label: "Новый поставщик" }]} />
      <Card>
        <CardHeader>
          <CardTitle as="h1" className="text-xl">Новый поставщик</CardTitle>
        </CardHeader>
        <CardContent>
          <SupplierForm action={createSupplier} />
        </CardContent>
      </Card>
    </div>
  );
}
