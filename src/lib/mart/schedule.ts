import "server-only";
import { enqueueMartRefresh } from "@/lib/mart/queue";

/**
 * Пересборка витрины после записей (решение владельца 22.11.2026: в фоне с задержкой 1–2 минуты). С 24.11.2026 — через очередь в базе
 * (src/lib/mart/queue.ts): переживает перезапуск, склеивает правки, безопасна при нескольких экземплярах сервера.
 * Вызывается из revalidateAll(): после закупки, лота, ТЗ, списания, оплаты, справочника. Витрины нет (демо) — ничего не ставится.
 */
export function scheduleMartRefresh(orgId?: string): void {
  if (!orgId || process.env.MART_AUTO_REFRESH === "0") return;
  void enqueueMartRefresh(orgId);
}
