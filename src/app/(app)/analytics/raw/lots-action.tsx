"use server";

import { requireSession } from "@/lib/session";
import { getYearFilter } from "@/lib/year-filter";
import { getCommission4Mode } from "@/lib/commission4-mode";
import {
  GROUPS, applyFilters, groupLots, groupUsage, isUsageBy, loadRawData, loadUsageRows,
  type GroupBy, type LotGroupBy, type RawFilters, type UsageGroupBy,
} from "@/lib/raw-analytics";
import { GroupLots } from "./lot-rows";
import { UsageGroupLots } from "./usage-rows";

function cleanFilters(f: RawFilters): RawFilters {
  return {
    scope: f.scope === "lining" ? "lining" : "fur",
    auction: String(f.auction ?? "").slice(0, 200),
    kind: String(f.kind ?? "").slice(0, 200),
    onlyRem: f.onlyRem === true,
    q: String(f.q ?? "").slice(0, 100),
    model: String(f.model ?? "").slice(0, 60),
  };
}

/** Лоты одной группы для раскрытия строки (организация и год — из сессии и cookie, а не от клиента). */
export async function loadGroupLots(by: GroupBy, key: string, f: RawFilters) {
  const session = await requireSession();
  const year = await getYearFilter();
  const c4 = await getCommission4Mode();
  const safeBy: LotGroupBy = GROUPS.some((g) => g.key === by) && !isUsageBy(by) ? (by as LotGroupBy) : "auction";
  const filters = cleanFilters(f);
  const data = await loadRawData(session.user.organizationId, year);
  const group = groupLots(applyFilters(data.lots, filters), safeBy).find((g) => g.key === String(key));
  if (!group) return <p className="px-3 py-3 text-sm text-neutral-400">Лоты не найдены — обновите страницу.</p>;
  return <GroupLots lots={group.lots} unit={filters.scope === "lining" ? "м" : "шт."} c4={c4} showAuction={safeBy !== "auction"} />;
}

/** Раскрытие строки «по изделию» / «по ТЗ»: лоты, из которых это сделано. */
export async function loadUsageGroupLots(by: UsageGroupBy, key: string, f: RawFilters) {
  const session = await requireSession();
  const year = await getYearFilter();
  const c4 = await getCommission4Mode();
  const filters = cleanFilters(f);
  const safeBy: UsageGroupBy = by === "order" ? "order" : "article";
  const [data, usage] = await Promise.all([loadRawData(session.user.organizationId, year), loadUsageRows(session.user.organizationId, year)]);
  const lots = applyFilters(data.lots, filters);
  const byId = new Map(lots.map((l) => [l.id, l]));
  const group = groupUsage(usage.filter((r) => byId.has(r.lotId)), safeBy).find((g) => g.key === String(key));
  if (!group) return <p className="px-3 py-3 text-sm text-neutral-400">Строки не найдены — обновите страницу.</p>;
  return <UsageGroupLots rows={group.rows} lots={byId} unit={filters.scope === "lining" ? "м" : "шт."} c4={c4} by={safeBy} />;
}

