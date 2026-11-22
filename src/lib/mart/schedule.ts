import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Пересборка витрины после записей (решение владельца 22.11.2026: смешанно — в фоне с задержкой 1–2 минуты, плюс кнопка «Обновить»).
 * Вызывается из revalidateAll(): после закупки, лота, ТЗ, списания, оплаты, справочника. Несколько правок подряд склеиваются в одну пересборку:
 * таймер каждый раз сбрасывается и срабатывает, когда запись «затихла» на DELAY_MS.
 * Витрины нет (демо, чистая база) — ничего не планируется. Выключатель: MART_AUTO_REFRESH=0 (тесты, разовые скрипты).
 */
const DELAY_MS = Math.max(0, Number(process.env.MART_REFRESH_DELAY_MS ?? 90_000)) || 90_000;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

async function orgsWithMart(orgId?: string): Promise<string[]> {
  if (orgId) {
    const rows = await prisma.$queryRaw<{ one: number }[]>`SELECT 1 AS one FROM "DmSku" WHERE "organizationId" = ${orgId} LIMIT 1`;
    return rows.length ? [orgId] : [];
  }
  const rows = await prisma.$queryRaw<{ organizationId: string }[]>`SELECT DISTINCT "organizationId" FROM "DmSku"`;
  return rows.map((r) => r.organizationId);
}

export function scheduleMartRefresh(orgId?: string): void {
  if (process.env.MART_AUTO_REFRESH === "0") return;
  void (async () => {
    try {
      for (const o of await orgsWithMart(orgId)) {
        const prev = timers.get(o);
        if (prev) clearTimeout(prev);
        const t = setTimeout(() => {
          timers.delete(o);
          void import("@/lib/mart/refresh").then((m) => m.refreshMartInBackground(o)).catch((e) => console.error("[mart] отложенная пересборка не запущена:", e));
        }, DELAY_MS);
        t.unref?.();
        timers.set(o, t);
      }
    } catch (e) {
      // Планирование не должно ломать сохранение данных.
      console.error("[mart] не удалось запланировать пересборку:", e);
    }
  })();
}
