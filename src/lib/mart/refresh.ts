import "server-only";
import { enqueueMartRefresh } from "@/lib/mart/queue";

/**
 * Пересборка витрины после загрузки данных (отчёт, прайс, приход/продажи) и после отката загрузки: ставится в очередь «как можно скорее»
 * (src/lib/mart/queue.ts). Ошибка не ломает загрузку: попадает в очередь как повтор, старая витрина остаётся до удачной пересборки.
 */
export function refreshMartInBackground(orgId: string): void {
  void enqueueMartRefresh(orgId, 0);
}
