export const INBOX_FILE_KINDS = [
  { key: "AUCTION_INVOICE", label: "PDF аукционного счёта" },
  { key: "PAYMENT_INVOICE", label: "Счёт Веллмеха на аванс" },
  { key: "SPECIFICATION", label: "Спецификация к Договору купли-продажи" },
  { key: "UPD", label: "УПД" },
  { key: "OTHER", label: "Другое" },
] as const;
export const INBOX_STATUS_LABEL: Record<string, string> = { DRAFT: "Черновик", SENT: "Отправлено нам", ACCEPTED: "Принято", REJECTED: "Отклонено" };
