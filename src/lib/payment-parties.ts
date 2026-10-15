/**
 * Стороны оплаты и единый вид номеров документов.
 * ВСЕ оплаты в приложении исходящие: платит наша компания (плательщик), получатель — поставщик сырья или подрядчик.
 * «Нам платят» не существует: ProductionPayment — оплата РАБОТЫ подрядчику по договору подряда, а «Client» в ТЗ — это мы (заказчик по договору).
 */

/** Плательщик во всех оплатах — наша компания (в ТЗ и выписке 1С: ООО «Меркури Мода»). */
export const PAYER_NAME = "ООО «Меркури Мода»";

/** Вид оплаты: за сырьё (мех, шкуры, подкладка — поставщику) или за работу (пошив — подрядчику). */
export type PayKind = "raw" | "prod";
export const PAY_KIND_LABEL: Record<PayKind, string> = { raw: "За сырьё", prod: "За работу" };

/** Подрядчик по договору из ТЗ: договор подряда № 1605 заключён с Веллмех (выписка 1С, ТЗ). Иной договор — не угадываем. */
export function contractorOfContract(contractNumber: string | null | undefined): string | null {
  return /(^|[^\d])1605([^\d]|$)/.test(contractNumber ?? "") ? "ООО «Веллмех»" : null;
}

/** Подрядчик оплаты за работу по договорам связанных ТЗ: один — он; разные — «несколько»; не определился — «—». */
export function contractorOfOrders(contracts: (string | null | undefined)[]): { name: string; key: string | null } {
  const names = Array.from(new Set(contracts.map(contractorOfContract).filter((x): x is string => !!x)));
  if (names.length === 1) return { name: names[0], key: names[0] };
  if (names.length > 1) return { name: "несколько", key: null };
  return { name: "—", key: null };
}

/** Номер документа без «№» в начале: «№ 46523» → «46523» (слово «П/п» / «Счёт» стоит в заголовке, дубля быть не должно). */
export const bareNo = (s: string | null | undefined) => (s ?? "").replace(/^\s*(№|N|no\.?)\s*/i, "").trim();
/** «103» + «03.07.2025» → «103 от 03.07.2025». */
export const docNo = (no: string | null | undefined, date?: string | null) => {
  const n = bareNo(no);
  return n ? `${n}${date ? ` от ${date}` : ""}` : "";
};

/** Название подрядчика ТЗ: выбранный подрядчик (contractorId), иначе по номеру договора. */
export function contractorNameOfOrder(o: { contractor?: { name: string } | null; contractNumber?: string | null }): string | null {
  return o.contractor?.name ?? contractorOfContract(o.contractNumber);
}

/** Получатель оплаты за работу: подрядчик платежа (contractorId), иначе подрядчики связанных ТЗ (contractorId или договор). Разные — «несколько». */
export function contractorOfPayment(
  payment: { contractor?: { name: string } | null },
  orders: { contractor?: { name: string } | null; contractNumber?: string | null }[],
): { name: string; key: string | null } {
  if (payment.contractor) return { name: payment.contractor.name, key: payment.contractor.name };
  const names = Array.from(new Set(orders.map(contractorNameOfOrder).filter((x): x is string => !!x)));
  if (names.length === 1) return { name: names[0], key: names[0] };
  if (names.length > 1) return { name: "несколько", key: null };
  return { name: "—", key: null };
}
