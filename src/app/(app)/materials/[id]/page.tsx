import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MaterialForm } from "../material-form";
import { CategoryQuickAdd } from "../category-quick-add";
import { updateMaterial } from "../actions";

export default async function EditMaterialPage({ params }: PageProps<"/materials/[id]">) {
  const { id } = await params;
  const session = await requireSession();
  const [material, categories] = await Promise.all([
    prisma.rawMaterial.findFirst({
      where: { id, organizationId: session.user.organizationId },
    }),
    prisma.rawMaterialCategory.findMany({
      where: { organizationId: session.user.organizationId },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!material) notFound();

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card>
        <CardContent className="pt-4">
          <CategoryQuickAdd />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Редактировать сырьё</CardTitle>
        </CardHeader>
        <CardContent>
          <MaterialForm
            action={updateMaterial.bind(null, id)}
            material={{ ...material, minStockLevel: material.minStockLevel?.toString() ?? null }}
            categories={categories}
          />
        </CardContent>
      </Card>
    </div>
  );
}
