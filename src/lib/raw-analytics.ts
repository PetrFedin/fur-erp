// Модуль разнесён по частям в _raw-analytics/; здесь — прежний путь импорта.
export { isUsageBy, GROUPS, NO_AUCTION_KEY, lotValues, SYNTHETIC_LABEL, loadRawData, lotBalances, lotIssues, isDormant, isOverused, daysSince, ageText, normLot, lotMatches, applyFilters, emptyAgg, addLot, aggOf, avgPrice, usedPct, groupLots, parseFilters, pctText, loadUsageRows, groupUsage, usageByLot } from "./_raw-analytics/is-usage-by";
export type { Scope, LotGroupBy, UsageGroupBy, GroupBy, RawData, RawFilters, Agg, Group, UsageGroup, UsageByLot } from "./_raw-analytics/is-usage-by";
export type { UsageRef, RawLot, UsageRow } from "./_raw-analytics/shared";
export { loadLotUsage, loadArticleLots, buildRecon } from "./_raw-analytics/load-lot-usage";
export type { LotOrderRow, HammerLine, LotPassport, LotCard, ArticleLot, ArticleLots, Recon } from "./_raw-analytics/load-lot-usage";
export { sizeOf } from "@/lib/lot-size";
export { categoryOf } from "@/lib/lot-size";
