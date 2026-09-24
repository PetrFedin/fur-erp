import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WarehouseForm } from "../warehouse-form";
import { createWarehouse } from "../actions";

export default function NewWarehousePage() {
  return (
    <div className="max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Новый склад</CardTitle>
        </CardHeader>
        <CardContent>
          <WarehouseForm action={createWarehouse} />
        </CardContent>
      </Card>
    </div>
  );
}
