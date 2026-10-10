import "server-only";
import { revalidatePath } from "next/cache";
import { invalidateFilterOptions } from "@/lib/filter-options";

/**
 * Данные изменились (закупка, лот, ТЗ, списание, оплата, артикул): все страницы и сводки пересчитываются при следующем открытии.
 * Вызывать из каждого server action, который пишет в базу, вместо перечисления страниц по одной.
 */
export function revalidateAll(orgId?: string) {
  revalidatePath("/", "layout");
  invalidateFilterOptions(orgId);
}
