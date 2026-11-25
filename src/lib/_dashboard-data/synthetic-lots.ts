// Шаг расчёта Сводки: «лоты»-заглушки для страницы «Сырьё» — заказанный, но не полученный мех и шкуры подрядчика (вынесено из loadDashboardImpl без изменений).
import { isPositive } from "@/domain/money";
import { NOT_SET, type FurLot } from "@/lib/fur-table";
import type { auctionLabeler } from "@/lib/filter-options";
import { auctionName } from "@/lib/auction-names";
import type { loadDebtInputs } from "@/lib/supplier-debt";
import type { Unreceived } from "./unreceived";

export function buildSyntheticLots({ debtInputs, labeler, unreceived, hidesTotal, hidesYear }: {
  debtInputs: Awaited<ReturnType<typeof loadDebtInputs>>;
  labeler: Awaited<ReturnType<typeof auctionLabeler>>;
  unreceived: Unreceived;
  hidesTotal: { incl: number; excl: number };
  hidesYear: Map<number, { incl: number; excl: number }>;
}): FurLot[] {
  // Поставщик строк «заказано» и «шкуры подрядчика» — из закупок партии (раньше подпись поставщика у них пропадала: у лотов-заглушек её нет).
  const supplierOfAuction = (name: string) => debtInputs.allPurchases.find((p) => p.status !== "CANCELLED" && auctionName(p.auctionSession) === name)?.supplier?.name ?? null;
  const contractorSupplier = () => debtInputs.allPurchases.find((p) => (p as { isContractorRaw?: boolean }).isContractorRaw)?.supplier?.name ?? null;
  const synth = (id: string, item: string, auction: string, year0: number, o: { qty: number; incl: number; excl: number }, used: { incl: number; excl: number } | null, money: { paid: number; due: number }, plan?: { q: number; s: number }, positions?: number): FurLot => ({
    id, kind: "fur", item, materialName: item, color: NOT_SET, size: NOT_SET, sizes: [], attrs: [], auction, auctionLabel: labeler(auction).label || auction, year: year0,
    lotNumber: used ? "шкуры подрядчика" : "заказано, не получено", grade: "", purchaseId: null, purchaseNumber: null, supplier: used ? contractorSupplier() : supplierOfAuction(auction),
    recv: o.qty, used: 0, rem: o.qty, recvIncl: o.incl, recvExcl: o.excl,
    usedIncl: used?.incl ?? 0, usedExcl: used?.excl ?? 0, usedExtraIncl: 0, usedExtraExcl: 0,
    remIncl: used ? 0 : o.incl, remExcl: used ? 0 : o.excl,
    vatRate: 22, usdPrice: null, usdSource: "none", usdQty: 0, usdSubtotal: 0, usdUsedQty: 0, usdUsedSubtotal: 0, usdRemQty: 0, usdRemSubtotal: 0,
    usdQtyDirect: 0, usdQtyEur: 0, usdQtyRub: 0, usdQtyCalc: 0, hammerExcl: null, hammerIncl: null, hammerSource: null, hamQty: 0, hamSubExcl: 0, hamSubIncl: 0, usages: [],
    purchaseStatus: used ? "RECEIVED" : "DRAFT", source: used ? "supplier" : "auction", paid: money.paid, due: money.due, usdPlanQty: plan?.q, usdPlanSubtotal: plan?.s, positions,
  });
  const syntheticLots: FurLot[] = [
    ...unreceived.byFur.map((g) => synth(`ordered:${g.label}`, g.label, g.names[0] ?? "Заказано", 2026, g.ordered, null, { paid: g.paid, due: g.due }, g.usd, g.positions)),
    // Шкуры подрядчика — по году оплаты (год лота = год оплаты): фильтр «Год закупки» таблицы «Сырьё» делит их так же, как Главная.
    ...(isPositive(hidesTotal.incl) ? Array.from(hidesYear).filter(([, v]) => v.incl > 0).sort((a, b) => a[0] - b[0]).map(([y, v]) => synth(`hides:${y}`, "Свакара", "Шкуры подрядчика", y, { qty: 0, incl: v.incl, excl: v.excl }, { incl: v.incl, excl: v.excl }, { paid: v.incl, due: 0 })) : []),
  ];
  return syntheticLots;
}
