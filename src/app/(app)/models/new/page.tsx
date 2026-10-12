import { ArticleForm } from "../article-form";
import { saveArticleForm } from "../actions";
import { requireSession } from "@/lib/session";
import { ACCESS, hasRole } from "@/lib/access";
import { getCategoryOptions } from "@/lib/categories";

export const metadata = { title: "Новый артикул" };

export default async function NewModelPage() {
  const session = await requireSession();
  const categories = await getCategoryOptions(session.user.organizationId);
  return (
    <ArticleForm
      mode="new"
      action={saveArticleForm.bind(null, null)}
      categories={categories}
      canCreateCategory={hasRole(session.user.role, ACCESS.categories)}
    />
  );
}
