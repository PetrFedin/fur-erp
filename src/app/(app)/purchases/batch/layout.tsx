import { requireRole } from "@/lib/session";
import { ACCESS } from "@/lib/access";

// Мастер «Новая партия» доступен ролям, которым разрешены закупки (та же проверка, что у серверных действий).
export default async function BatchLayout({ children }: { children: React.ReactNode }) {
  await requireRole(...ACCESS.purchases);
  return <>{children}</>;
}
