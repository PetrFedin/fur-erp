/**
 * Закупка-услуга: УПД/счёт поставщика на услуги и прочие расходы, без позиций сырья (нет лотов, нет аукциона).
 * Деньги по ней показываются отдельной статьёй «Услуги по УПД» и не входят ни в «Куплено», ни в «Оплачено / К оплате» по меху и подкладке.
 * Признак один на все экраны: у закупки нет позиций, но есть расходы, и она не отменена.
 */
export const SERVICES_LABEL = "Услуги по УПД";

export function isServicePurchase(p: { status: string; items: readonly unknown[]; expenses: readonly unknown[] }): boolean {
  return p.status !== "CANCELLED" && p.items.length === 0 && p.expenses.length > 0;
}

/** То же по счётчикам (когда позиции и расходы не загружены): `_count` из Prisma. */
export function isServicePurchaseByCount(p: { status: string; _count: { items: number; expenses: number } }): boolean {
  return p.status !== "CANCELLED" && p._count.items === 0 && p._count.expenses > 0;
}
