"use server";

import { requireSession } from "@/lib/session";
import { loadSummary } from "@/lib/purchase-summary";
import { AuctionBody, aKey, filterLeaves } from "./summary-view";

/**
 * Содержимое строки «аукцион» в сводке по годам (материалы и лоты) — при раскрытии.
 * Данные и фильтры те же, что у страницы; организация берётся из сессии.
 */
export async function loadSummaryAuction(
  year: number,
  auction: string,
  filterYear: number,
  filterAuction: string,
  filterMaterial: string,
  mode: "incl" | "excl",
) {
  const session = await requireSession();
  const { leaves: all } = await loadSummary(session.user.organizationId);
  const leaves = filterLeaves(all, {
    year: filterYear > 0 ? filterYear : null,
    auction: String(filterAuction).slice(0, 300),
    material: String(filterMaterial).slice(0, 300),
  });
  const al = leaves.filter((l) => l.year === Number(year) && aKey(l) === String(auction));
  return (
    <div>
      <AuctionBody al={al} mode={mode === "excl" ? "excl" : "incl"} />
    </div>
  );
}
