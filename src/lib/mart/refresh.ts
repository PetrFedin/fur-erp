import "server-only";
import { prisma } from "@/lib/prisma";
import { buildMart } from "@/lib/mart/build";

/** Одна пересборка за раз на организацию; если во время неё пришла ещё одна загрузка — после окончания пересобираем ещё раз. */
const running = new Map<string, { again: boolean }>();

/**
 * Пересобирает единый массив данных (Dm*) в фоне после загрузки данных (отчёт, прайс, приход/продажи) и после отката загрузки.
 * Ошибка не ломает загрузку: пишется в журнал сервера, а старый массив остаётся прежним до следующей удачной пересборки.
 */
export function refreshMartInBackground(orgId: string): void {
  const st = running.get(orgId);
  if (st) { st.again = true; return; }
  const state = { again: false };
  running.set(orgId, state);
  void (async () => {
    try {
      do { state.again = false; await buildMart(prisma, orgId); } while (state.again);
    } catch (e) {
      console.error("[mart] пересборка после загрузки не удалась:", e);
    } finally {
      running.delete(orgId);
    }
  })();
}
