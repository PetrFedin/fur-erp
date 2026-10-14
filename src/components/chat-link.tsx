import Link from "next/link";
import { CHAT_INTERNAL_ROLES } from "@/lib/chat-core";

/**
 * Кнопка «Написать / Запросить» на карточке записи: открывает обсуждение по этой записи в чате
 * (или форму нового запроса, если обсуждения ещё нет). Роли без чата кнопку не видят.
 */
export function ChatLink({ type, id, role, label = "Написать / Запросить", className = "" }: { type: string; id: string; role: string; label?: string; className?: string }) {
  if (role !== "SUPPLIER" && !(CHAT_INTERNAL_ROLES as readonly string[]).includes(role)) return null;
  return (
    <Link
      href={`/chat?entity=${type}:${id}`}
      title="Открыть обсуждение по этой записи в чате"
      className={`inline-flex items-center rounded border border-neutral-300 px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50 max-md:min-h-10 ${className}`}
    >
      {label}
    </Link>
  );
}
