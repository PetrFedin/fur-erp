import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MaterialForm } from "../material-form";
import { CategoryQuickAdd } from "../category-quick-add";
import { createMaterial } from "../actions";

export default async function NewMaterialPage() {
  const session = await requireSession();
  const categories = await prisma.rawMaterialCategory.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card>
        <CardContent className="pt-4">
          <CategoryQuickAdd />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Новое сырьё</CardTitle>
        </CardHeader>
        <CardContent>
          <MaterialForm action={createMaterial} categories={categories} />
        </CardContent>
      </Card>
    </div>
  );
}
