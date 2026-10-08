import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ModelForm } from "../model-form";
import { createModel } from "../actions";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { getCategoryOptions } from "@/lib/categories";

export const metadata = { title: "Новая модель" };

export default async function NewModelPage() {
  const session = await requireSession();
  const categories = await getCategoryOptions(session.user.organizationId);
  return (
    <div>
      <Card>
        <CardHeader>
          <CardTitle as="h1" className="text-xl">Новая модель изделия</CardTitle>
        </CardHeader>
        <CardContent>
          <ModelForm action={createModel} categories={categories} canCreateCategory={hasRole(session.user.role, ACCESS.categories)} />
        </CardContent>
      </Card>
    </div>
  );
}
