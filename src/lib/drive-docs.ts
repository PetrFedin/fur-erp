// Документы Google Drive: типы, подписи и разбор ссылок. Без обращения к БД —
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
  /** Есть ли у записи внешняя ссылка (сама ссылка в интерфейс не отдаётся). */
  hasLink?: boolean;
  drivePath: string | null;
  /** Подпись «к чему привязан», если документ показан не на своей странице. */
  scope?: string | null;
  /** Может ли текущий пользователь убрать ссылку (undefined — решает canEdit списка). */
  canRemove?: boolean;
  /** Есть ли оригинал файла в приложении (открывается через /api/drive-docs/<id>). */
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

/** Id файла Google Drive: 20+ символов [A-Za-z0-9_-]. */
const ID_RE = /^[A-Za-z0-9_-]{20,}$/;
/** Похоже на настоящий id: и буквы, и цифры (обычное слово или число id не считается). */
const looksLikeId = (s: string) => ID_RE.test(s) && /[A-Za-z]/.test(s) && /\d/.test(s);
const DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com", "drive.usercontent.google.com"]);

/** Извлекает fileId и нормальную ссылку просмотра из ссылки Google Drive / Docs (или голого id). */
export function parseDriveLink(raw: string): { fileId: string; viewUrl: string } | null {
  const s = raw.trim();
  if (!s) return null;
  if (looksLikeId(s)) return { fileId: s, viewUrl: `https://drive.google.com/file/d/${s}/view` };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (!DRIVE_HOSTS.has(host)) return null;
  const m = /\/(?:d|folders)\/([A-Za-z0-9_-]{20,})/.exec(u.pathname);
  const id = m?.[1] ?? u.searchParams.get("id");
  if (!id || !looksLikeId(id)) return null;
  const isFolder = /\/folders\//.test(u.pathname);
  const viewUrl = isFolder ? `https://drive.google.com/drive/folders/${id}` : `https://drive.google.com/file/d/${id}/view`;
  return { fileId: id, viewUrl };
}

/** Ссылку открываем только если она ведёт на Google (защита от подмены в данных). */
export function safeViewUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "google.com" || u.hostname.endsWith(".google.com")) ? u.toString() : null;
  } catch {
    return null;
  }
}
