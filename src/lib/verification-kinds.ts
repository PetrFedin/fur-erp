// Виды строк, которые можно подтвердить. Отдельный модуль без server-only: нужен и клиентским компонентам.
export type VerifyKind = "payment" | "prodPayment" | "purchase" | "order" | "batch";
export const VERIFY_KINDS: VerifyKind[] = ["payment", "prodPayment", "purchase", "order", "batch"];
export const KIND_LABEL: Record<VerifyKind, string> = {
  payment: "Платёж поставщику",
  prodPayment: "Оплата производства",
  purchase: "Закупка",
  order: "ТЗ",
  batch: "Партия",
};
