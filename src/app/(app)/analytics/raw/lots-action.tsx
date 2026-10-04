"use server";

import { requireSession } from "@/lib/session";
import { getYearFilter } from "@/lib/year-filter";
import { getCommission4Mode } from "@/lib/commission4-mode";
import { GROUPS, applyFilters, groupLots, loadRawData, type GroupBy, type RawFilters } from "@/lib/raw-analytics";
import { GroupLots } from "./lot-rows";

/** Лоты одной группы для раскрытия строки (организация и год — из сессии и cookie, а не от клиента). */
export async function loadGroupLots(by: GroupBy, key: string, f: RawFilters) {
  const session = await requireSession();
  const year = await getYearFilter();
  const c4 = await getCommission4Mode();
  const safeBy: GroupBy = GROUPS.some((g) => g.key === by) ? by : "auction";
  const filters: RawFilters = {
    scope: f.scope === "lining" ? "lining" : "fur",
    auction: String(f.auction ?? "").slice(0, 200),
    kind: String(f.kind ?? "").slice(0, 200),
    onlyRem: f.onlyRem === true,
    q: String(f.q ?? "").slice(0, 100),
  };
  const data = await loadRawData(session.user.organizationId, year);
  const group = groupLots(applyFilters(data.lots, filters), safeBy).find((g) => g.key === String(key));
  if (!group) return <p className="px-3 py-3 text-sm text-neutral-400">Лоты не найдены — обновите страницу.</p>;
  return <GroupLots lots={group.lots} unit={filters.scope === "lining" ? "м" : "шт."} c4={c4} showAuction={safeBy !== "auction"} />;
}
