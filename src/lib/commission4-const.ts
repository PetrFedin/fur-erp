// Константы «4%» без зависимостей от Prisma — безопасно импортировать из клиентских компонентов.
export const COMMISSION_RATE = 0.04;
/** Партия, у которой 4% не начисляется (списания ТЗ этой партии — commission4 = false). */
export const NO_COMMISSION4_BATCH = 6;
/** Значение «Начислять 4%» по умолчанию для нового списания ТЗ из партии с этим номером. */
export const defaultCommission4 = (batchNumber: number | null | undefined) => batchNumber !== NO_COMMISSION4_BATCH;
export const COMMISSION4_HINT =
  "4% — доп. комиссия посредника (Веллмех): мы платим на 4% больше за мех и подкладку в ТЗ (4% от цены без НДС, затем НДС по ставке лота); работа, расходы, фурнитура и закупочные счета не меняются";
