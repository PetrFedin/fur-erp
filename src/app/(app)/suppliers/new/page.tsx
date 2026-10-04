import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SupplierForm } from "../supplier-form";
import { createSupplier } from "../actions";

export default function NewSupplierPage() {
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <div className="text-sm"><Link href="/suppliers" className="text-neutral-500 hover:underline">← Поставщики</Link></div>
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
