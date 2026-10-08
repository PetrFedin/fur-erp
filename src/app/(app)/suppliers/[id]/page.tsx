import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
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
  const canEdit = hasRole(session.user.role, ACCESS.suppliers);

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm"><Link href="/suppliers" className="text-neutral-500 hover:underline">← Поставщики</Link></div>
      <Card>
        <CardHeader>
          <CardTitle as="h1" className="text-xl">Редактировать поставщика</CardTitle>
        </CardHeader>
        <CardContent>
          {!canEdit && <p className="mb-3 text-sm text-neutral-500">Только просмотр: редактировать поставщиков могут владелец, администратор и закупщик.</p>}
          <fieldset disabled={!canEdit} className="min-w-0 border-0 p-0">
            <SupplierForm action={boundAction} supplier={supplier} />
          </fieldset>
        </CardContent>
      </Card>
    </div>
  );
}
