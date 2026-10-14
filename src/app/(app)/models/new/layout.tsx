import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";

// Страница создания доступна только ролям, которым разрешает действие.
export default async function NewLayout({ children }: { children: React.ReactNode }) {
  // Новый артикул могут вносить и из кабинета поставщика (форма без цены).
  await requireRole(...ACCESS.models, "SUPPLIER");
  return <>{children}</>;
}
