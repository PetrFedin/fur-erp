import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SupplierForm } from "../supplier-form";
import { updateSupplier } from "../actions";

export default async function EditSupplierPage({ params }: PageProps<"/suppliers/[id]">) {
  const { id } = await params;
  const session = await requireSession();
  const supplier = await prisma.supplier.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!supplier) notFound();

  const boundAction = updateSupplier.bind(null, id);

  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Редактировать поставщика</CardTitle>
        </CardHeader>
        <CardContent>
          <SupplierForm action={boundAction} supplier={supplier} />
        </CardContent>
      </Card>
    </div>
  );
}
