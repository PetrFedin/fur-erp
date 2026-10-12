import { Breadcrumbs } from "@/components/breadcrumbs";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
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
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Сырьё", href: "/lots" }, { label: "Материалы", href: "/materials" }, { label: material.name }]} />
      <h1 className="text-xl font-semibold">Редактировать материал</h1>
      <Card>
        <CardContent className="pt-4">
          <MaterialForm
            action={updateMaterial.bind(null, id)}
            material={{ ...material, minStockLevel: material.minStockLevel?.toString() ?? null, defaultVatRate: material.defaultVatRate?.toString() ?? null }}
            categories={categories}
          />
        </CardContent>
      </Card>
      <details className="rounded-md border border-neutral-200 bg-white">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Добавить категорию</summary>
        <div className="border-t border-neutral-100 p-3">
          <CategoryQuickAdd />
        </div>
      </details>
    </div>
  );
}
