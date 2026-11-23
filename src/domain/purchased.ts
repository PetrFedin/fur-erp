import { SERVICES_LABEL, isServicePurchase } from "@/lib/service-purchase";
import { sumPairs, type VatPair } from "@/domain/money";

/**
 * Единое определение «Куплено» по сырью (меху и подкладке) — одно для Главной, «Сырья», «Закупок», витрины и оплат.
 *
 *   Куплено = полученные лоты + заказанное, но ещё не принятое (решение владельца 21.10.2026: черновики закупок входят в «Куплено»,
 *             чтобы «куплено = оплачено + долг» сходилось с «общей стоимостью» из оплат).
 *   Вне «Куплено»:
 *     • шкуры подрядчика — доплата НДС 22 % по сырью заказчика, оплачена в составе пошива (решение владельца 23.11.2026);
 *     • услуги по УПД — закупки без позиций сырья (гребни, брелки, образцы, доп. услуги): не сырьё, показываются в «Оплатах».
 *   «Общая стоимость сырья» (для оплат) = Куплено + шкуры подрядчика; услуги — отдельной статьёй рядом.
 */
export type PurchasedParts = {
  /** Принятые на склад лоты. */
  receivedLots: VatPair;
  /** Позиции закупок, заказанные и ещё не принятые (лотов нет). */
  orderedNotReceived: VatPair;
  /** Шкуры подрядчика, оплаченные в составе счетов за пошив. */
  contractorHides: VatPair;
  /** Закупки-услуги без позиций сырья. */
  services: VatPair;
};

export type PurchasedTotals = {
  /** «Куплено» по сырью. */
  bought: VatPair;
  /** «Общая стоимость» сырья в оплатах: куплено + шкуры подрядчика. */
  rawTotalCost: VatPair;
  /** Услуги по УПД (отдельная статья). */
  services: VatPair;
  /** Всё, что платим поставщику за закупки: общая стоимость сырья + услуги. */
  payableToSupplier: VatPair;
};

export function purchasedTotals(parts: PurchasedParts): PurchasedTotals {
  const bought = sumPairs([parts.receivedLots, parts.orderedNotReceived]);
  const rawTotalCost = sumPairs([bought, parts.contractorHides]);
  return { bought, rawTotalCost, services: parts.services, payableToSupplier: sumPairs([rawTotalCost, parts.services]) };
}

export type PurchaseCategory = "cancelled" | "service" | "ordered" | "received";

/** К какой части «Куплено» относится закупка: услуга (вне), заказана и не принята (в «Куплено»), принята (в «Куплено»), отменена (нигде). */
export function purchaseCategory(p: { status: string; items: readonly unknown[]; expenses: readonly unknown[] }): PurchaseCategory {
  if (p.status === "CANCELLED") return "cancelled";
  if (isServicePurchase(p)) return "service";
  return p.status === "RECEIVED" ? "received" : "ordered";
}
/** Входит ли закупка в «Куплено» по сырью. */
export const countsAsBought = (c: PurchaseCategory): boolean => c === "received" || c === "ordered";

/** Короткое правило для подсказок «i» и глоссария — одна формулировка на всё приложение. */
export const BOUGHT_RULE =
  "Куплено = полученные лоты + заказанное, но ещё не принятое. Шкуры подрядчика (оплачены в составе пошива) и услуги по УПД в «Куплено» не входят.";
export { SERVICES_LABEL };
