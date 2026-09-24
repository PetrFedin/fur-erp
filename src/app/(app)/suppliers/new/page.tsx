import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SupplierForm } from "../supplier-form";
import { createSupplier } from "../actions";

export default function NewSupplierPage() {
  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Новый поставщик</CardTitle>
        </CardHeader>
        <CardContent>
          <SupplierForm action={createSupplier} />
        </CardContent>
      </Card>
    </div>
  );
}
