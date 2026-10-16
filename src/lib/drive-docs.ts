// Документы (DriveDocument): типы и подписи. Без обращения к БД —
// можно импортировать и в клиентских компонентах.

export const DRIVE_DOC_TYPES = [
  "AUCTION_INVOICE",
  "UPD",
  "CALC_SHEET",
  "SPECIFICATION",
  "CONTRACT",
  "TZ_APPENDIX",
  "PAYMENT_PROOF",
  "PAYMENT_INVOICE",
  "APPROVAL_EMAIL",
  "BALANCE",
  "OTHER",
] as const;
export type DriveDocTypeKey = (typeof DRIVE_DOC_TYPES)[number];

export const DRIVE_DOC_TYPE_LABELS: Record<DriveDocTypeKey, string> = {
  AUCTION_INVOICE: "Счёт аукциона",
  UPD: "УПД",
  CALC_SHEET: "Расчётный лист",
  SPECIFICATION: "Спецификация",
  CONTRACT: "Договор",
  TZ_APPENDIX: "Приложение к ТЗ",
  PAYMENT_PROOF: "Платёжка",
  PAYMENT_INVOICE: "Счёт на оплату",
  APPROVAL_EMAIL: "Письмо-согласование",
  BALANCE: "Баланс / сверка",
  OTHER: "Другое",
};

export type DriveDocView = {
  id: string;
  title: string;
  docType: DriveDocTypeKey;
  docDate: string | null;
  docNumber: string | null;
  /** Запись создана заранее (документ назван, файла не было): «удалить файл» оставляет запись «не прикреплён». */
  keepsRecord?: boolean;
  /** Подпись «к чему привязан», если документ показан не на своей странице. */
  scope?: string | null;
  /** Может ли текущий пользователь убрать документ (undefined — решает canEdit списка). */
  canRemove?: boolean;
  /** Прикреплён ли файл (открывается через /api/drive-docs/<id>). */
  hasFile?: boolean;
  storedName?: string | null;
  storedMime?: string | null;
  storedSize?: number | null;
  /** Примечание к документу (для окна «Изменить»). */
  notes?: string | null;
  /** Версия метаданных на момент показа (защита от одновременной правки). */
  version?: string;
};

/**
 * Тип документа по имени файла (подсказка при загрузке; пользователь может поправить).
 * «Платёжка_123.pdf» → PAYMENT_PROOF, «УПД 143» → UPD, «ТЗ 88» → TZ_APPENDIX…; не распознано — null.
 */
export function guessDocType(fileName: string): DriveDocTypeKey | null {
  const n = fileName.toLowerCase().replace(/ё/g, "е");
  const rules: [RegExp, DriveDocTypeKey][] = [
    [/платеж|п[\/-]п|(?<![\p{L}\d])пп(?![\p{L}\d])|payment|swift|квитанц/u, "PAYMENT_PROOF"],
    [/упд|\bupd\b|универсальн.*передат|(?<![\p{L}\d])акт(?![\p{L}\d])/u, "UPD"],
    [/сч[её]т.*оплат|на оплату|proforma|проформ/, "PAYMENT_INVOICE"],
    [/расчет|calc/, "CALC_SHEET"],
    [/специф|specification/, "SPECIFICATION"],
    [/договор|contract/, "CONTRACT"],
    [/(?<![\p{L}\d])тз(?![\p{L}\d])|тех.*задан|приложени/u, "TZ_APPENDIX"],
    [/письм|e-?mail|согласован/, "APPROVAL_EMAIL"],
    [/баланс|сверк|reconcil/, "BALANCE"],
    [/сч[её]т|invoice|инвойс|аукцион/, "AUCTION_INVOICE"],
  ];
  for (const [re, t] of rules) if (re.test(n)) return t;
  return null;
}
