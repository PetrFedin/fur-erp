import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";

// Страница создания доступна только ролям, которым разрешает действие.
export default async function NewLayout({ children }: { children: React.ReactNode }) {
  await requireRole(...ACCESS.suppliers);
  return <>{children}</>;
}
