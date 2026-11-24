import "server-only";
import { prisma } from "@/lib/prisma";
import { loadAuctionSummaries, type AuctionPay } from "@/lib/auction-payments";
import { martCached } from "@/lib/mart/cached";

/**
 * Сводка оплат по аукционам для экранов («Оплаты», карточки закупки и аукциона, лоты, «Требует внимания»): снимок витрины pay:auctions,
 * а если витрина устарела — тот же расчёт вживую. Действия с записью (транзакции) считают вживую сами (loadAuctionSummaries(tx, …)).
 * names — только эти аукционы (строка аукциона не зависит от остальных, поэтому отбор из полного списка = расчёт по одному имени).
 */
export async function auctionSummariesView(orgId: string, names?: string[]): Promise<AuctionPay[]> {
  const all = await martCached(orgId, "pay:auctions", () => loadAuctionSummaries(prisma, orgId));
  if (!names) return all;
  const want = new Set(names);
  return all.filter((a) => want.has(a.name));
}
