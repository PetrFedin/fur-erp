export const INBOX_FILE_KINDS = [
  { key: "AUCTION_INVOICE", label: "PDF аукционного счёта" },
  { key: "PAYMENT_INVOICE", label: "Счёт Веллмеха на аванс" },
  { key: "SPECIFICATION", label: "Спецификация к Договору купли-продажи" },
  { key: "UPD", label: "УПД" },
  { key: "OTHER", label: "Другое" },
] as const;
export const INBOX_STATUS_LABEL: Record<string, string> = { DRAFT: "Черновик", SENT: "Отправлено", ACCEPTED: "Принято нами", REJECTED: "Возвращено" };
/** Что значит статус — одной фразой для поставщика (с учётом вида документа). */
export const INBOX_STATUS_HELP: Record<string, string> = {
  DRAFT: "Виден только вам. Готово — «Отправить нам».",
  SENT: "На проверке у нас, править нельзя.",
  ACCEPTED: "Принято, править нельзя.",
  REJECTED: "Возвращено на доработку, замечание ниже.",
};
