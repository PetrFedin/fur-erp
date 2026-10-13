import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { MaterialForm } from "../material-form";
import { CategoryQuickAdd } from "../category-quick-add";
import { createMaterial } from "../actions";

const VALID_UNITS = ["PIECE", "KG", "M2", "M", "SET"];

export const metadata = { title: "Новый материал" };

export default async function NewMaterialPage({ searchParams }: PageProps<"/materials/new">) {
  const session = await requireSession();
  const sp = await searchParams;
  const unitParam = typeof sp.unit === "string" ? sp.unit : undefined;
  const defaultUnit = unitParam && VALID_UNITS.includes(unitParam) ? unitParam : undefined;
  const categories = await prisma.rawMaterialCategory.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: "Настройки", href: "/settings" }, { label: "Материалы", href: "/materials" }, { label: "Новый материал" }]} />
      <h1 className="text-xl font-semibold">Новый материал</h1>
      <Card>
        <CardContent className="pt-4">
          <MaterialForm action={createMaterial} categories={categories} defaultUnit={defaultUnit} />
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
