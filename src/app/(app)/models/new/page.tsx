import { Breadcrumbs } from "@/components/breadcrumbs";
import { ArticleForm } from "../article-form";
import { saveArticleForm, createArticleBySupplier } from "../actions";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { getCategoryOptions } from "@/lib/categories";

export const metadata = { title: "Новый артикул" };

export default async function NewModelPage() {
  const session = await requireSession({ allowSupplier: true });
  const supplier = session.user.role === "SUPPLIER";
  const categories = await getCategoryOptions(session.user.organizationId);
  return (
    <div className="flex flex-col gap-4">
    <Breadcrumbs items={[{ label: "Изделия", href: "/articles" }, { label: "Новый артикул" }]} />
    <ArticleForm
      mode="new"
      action={supplier ? createArticleBySupplier : saveArticleForm.bind(null, null)}
      noPrice={supplier}
      categories={categories}
      canCreateCategory={hasRole(session.user.role, ACCESS.categories)}
    />
    </div>
  );
}
