// Единое определение «куплено на аукционе» / «куплено у поставщика» для виджетов «Мех — куплено / использовано / остаток».
// Без server-only: годится и для клиентских компонентов, и для скриптов.
import { figures, flowOf, type FurLot } from "./fur-table";

/**
 * Источник закупки — ровно один из двух: настоящий аукцион или поставщик.
 * «Заказано, не получено» (черновики СП 09.26, FH 06.26 и т. п.) — закупки настоящих аукционов, поэтому «auction».
 * «Шкуры подрядчика» (isContractorRaw: З-2026-0001, 0010…0013 и заглушки hides) — сырьё поставщика (Веллмех), поэтому «supplier».
 */
export type PurchaseSource = "auction" | "supplier";

/**
 * Дома, которые считаются настоящими пушными аукционами (поле Auction.house). Всё остальное в справочнике —
 * не аукцион: «Прочее» (Белая норка №80/№96, «Без аукциона», «Сырьё подрядчика»), «КФХ / ферма» (прямая закупка на ферме),
 * «Подкладка / ткани». Расширить список можно здесь — это единственное место.
 */
export const AUCTION_HOUSES = ["SAGA", "Kopenhagen", "Kopenhagen Fur", "Fur Harvesters", "AME", "Союзпушнина", "Русьпушнина"] as const;
const HOUSES = new Set(AUCTION_HOUSES.map((h) => h.toLowerCase()));

/**
 * Закупка (по её записи Auction) → «auction» | «supplier». Аукцион — только если закупка привязана к записи справочника
 * (Purchase.auctionId), вид записи — мех (FUR) и её дом — из AUCTION_HOUSES. Нет привязки — закупка у поставщика.
 * Признак Purchase.isContractorRaw (шкуры подрядчика) учитывается отдельно, в classifyLotSource.
 */
export function classifyPurchaseSource(auction: { kind: string; house: string | null } | null | undefined): "auction" | "supplier" {
  if (!auction || auction.kind !== "FUR") return "supplier";
  return auction.house && HOUSES.has(auction.house.trim().toLowerCase()) ? "auction" : "supplier";
}

/** Источник лота: в строке лота он уже посчитан при загрузке (furLotFromRecord / заглушки Главной). */
export const classifyLotSource = (l: Pick<FurLot, "source">): PurchaseSource => (l.source === "auction" ? "auction" : "supplier");

export const SOURCE_LABEL: Record<PurchaseSource, string> = {
  auction: "Куплено на аукционах",
  supplier: "Куплено у поставщика",
};
export const SOURCE_ORDER: PurchaseSource[] = ["auction", "supplier"];

export type SourceSplitRow = { source: PurchaseSource; qty: number; incl: number; excl: number; lots: number };

/** Куплено по источникам: те же flowOf/figures, что дают «Куплено» плитки (шт. и ₽ с НДС и без НДС). Пустые источники не возвращаются. */
export function splitLotsBySource(lots: FurLot[]): SourceSplitRow[] {
  return SOURCE_ORDER.map((source) => {
    const ls = lots.filter((l) => classifyLotSource(l) === source);
    const fl = flowOf(ls);
    const i = figures(fl, { vat: "incl", c4: "off" });
    const e = figures(fl, { vat: "excl", c4: "off" });
    return { source, qty: i.recvQty, incl: i.recvValue, excl: e.recvValue, lots: ls.length };
  }).filter((r) => r.lots > 0 || Math.abs(r.incl) >= 0.5 || r.qty > 0);
}
