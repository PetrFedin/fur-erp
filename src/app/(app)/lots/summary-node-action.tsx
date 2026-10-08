"use server";

import { requireSession } from "@/lib/session";
import { loadSummary } from "@/lib/purchase-summary";
import { AuctionBody, aKey, filterLeaves, kindOf } from "./summary-view";

/**
 * Содержимое строки «аукцион» в сводке по годам (материалы и лоты) — при раскрытии.
 * Данные и фильтры те же, что у страницы; организация берётся из сессии.
 */
export async function loadSummaryAuction(
  year: number,
  auction: string,
  filterYear: number,
  filterAuction: string[],
  filterMaterial: string[],
  filterYears: number[],
  mode: "incl" | "excl",
  kind: "fur" | "lining",
  filterAttr: string[] = [],
) {
  const session = await requireSession();
  const { leaves: all } = await loadSummary(session.user.organizationId);
  const leaves = filterLeaves(all, {
    year: filterYear > 0 ? filterYear : null,
    auction: (Array.isArray(filterAuction) ? filterAuction : []).slice(0, 60).map((v) => String(v).slice(0, 300)),
    material: (Array.isArray(filterMaterial) ? filterMaterial : []).slice(0, 60).map((v) => String(v).slice(0, 300)),
    attr: (Array.isArray(filterAttr) ? filterAttr : []).slice(0, 60).map((v) => String(v).slice(0, 80)),
    years: (Array.isArray(filterYears) ? filterYears : []).slice(0, 20).map(Number).filter((n) => Number.isInteger(n)),
  });
  const al = leaves.filter((l) => l.year === Number(year) && aKey(l) === String(auction) && kindOf(l) === (kind === "lining" ? "lining" : "fur"));
  return (
    <div>
      <AuctionBody al={al} mode={mode === "excl" ? "excl" : "incl"} />
    </div>
  );
}
