import "server-only";
import { revalidatePath } from "next/cache";
import { invalidateFilterOptions } from "@/lib/filter-options";
import { invalidateControlCounts } from "@/lib/control-counts";
import { scheduleMartRefresh } from "@/lib/mart/schedule";
import { markDataChanged } from "@/lib/mart/snapshots";

/**
 * Данные изменились (закупка, лот, ТЗ, списание, оплата, артикул): все страницы и сводки пересчитываются при следующем открытии.
 * Вызывать из каждого server action, который пишет в базу, вместо перечисления страниц по одной.
 */
export function revalidateAll(orgId?: string) {
  revalidatePath("/", "layout");
  invalidateFilterOptions(orgId);
  // Счётчики «Контроля» и вкладок живут в памяти 20 с: после любой записи сбрасываем, чтобы числа не отставали.
  if (orgId) invalidateControlCounts(orgId);
  // Витрина данных пересобирается в фоне через 1–2 минуты после последней записи (решение владельца 22.11.2026); без витрины ничего не делает.
  // Снимки экранов в витрине устарели с этой минуты: экраны считают вживую, пока не пересоберётся витрина.
  if (orgId) void markDataChanged(orgId);
  scheduleMartRefresh(orgId);
}
