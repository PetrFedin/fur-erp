import "server-only";
import { Decimal } from "@prisma/client/runtime/library";
import { loadRawData, SYNTHETIC_LABEL, type RawData, type RawLot } from "@/lib/raw-analytics";
import { loadDashboard, type DashboardData } from "@/lib/dashboard-data";
import { parseDashFilters } from "@/lib/dashboard-calc";
import type { FurLot } from "@/lib/fur-table";
import type { YearFilter } from "@/lib/year-filter";
import type { Commission4Mode } from "@/lib/commission4-mode";

/**
 * «Всё сырьё считается как на Главной»: лоты склада + две строки моста, которые уже посчитала Главная
 * (loadDashboard → syntheticLots): «Заказано, не получено» (лотов ещё нет) и «Шкуры подрядчика».
 * Свои копии расчёта не держим — берём ровно те же строки, что и таблица «Сырьё → Мех» (/lots).
 */
function toRawLot(s: FurLot): RawLot {
  const kind: "ordered" | "hides" = s.id.startsWith("hides:") ? "hides" : "ordered";
  const d = (n: number) => new Decimal(n);
  const recv = d(s.recv);
  return {
    id: s.id, lotNumber: SYNTHETIC_LABEL[kind].toLowerCase(), auction: s.auction, auctionLabel: s.auctionLabel, year: s.year, month: `${s.year}-01`,
    kind: s.item, materialName: s.item, unit: "шт.", cat: SYNTHETIC_LABEL[kind], size: "Не указан", sizes: [], attrs: [],
    purchaseId: null, purchaseNumber: null,
    recv, used: d(0), rem: d(s.rem),
    unitIncl: recv.greaterThan(0) ? d(s.recvIncl).div(recv) : d(0), unitExcl: recv.greaterThan(0) ? d(s.recvExcl).div(recv) : d(0),
    usedIncl: d(s.usedIncl), usedExcl: d(s.usedExcl), usedExtraIncl: d(0), usedExtraExcl: d(0),
    usages: [], gradeEmpty: false, otherOut: d(0), movementGap: d(0),
    date: new Date(Date.UTC(s.year, 0, 1)), itemsQty: d(0),
    jIn: recv, jProdOut: d(0), jOtherOut: d(0), jNet: d(s.rem),
    synthetic: kind,
    fixed: { recvIncl: d(s.recvIncl), recvExcl: d(s.recvExcl), remIncl: d(s.remIncl), remExcl: d(s.remExcl) },
  };
}

export type RawWithDashboard = { data: RawData; dash: DashboardData; /** Лоты склада + строки моста («Заказано, не получено», «Шкуры подрядчика»): всё сырьё как на Главной. */ all: RawLot[] };

export async function loadRawWithDashboard(organizationId: string, year: YearFilter, c4: Commission4Mode): Promise<RawWithDashboard> {
  const [data, dash] = await Promise.all([loadRawData(organizationId, year), loadDashboard(organizationId, year, parseDashFilters({}), c4)]);
  return { data, dash, all: [...data.lots, ...dash.syntheticLots.map(toRawLot)] };
}
