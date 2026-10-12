// «Документы-основания»: какие документы упомянуты в данных (номера УПД, счетов, спецификаций, платёжек…)
// и какие из них уже загружены. Чистые функции без обращения к БД — годятся и для клиента, и для сценария проверки.

import type { DriveDocTypeKey } from "@/lib/drive-docs";

/** Куда привязывается загруженный документ (поддерживает server action uploadDriveDocument). */
export type SourceTarget = { entity: "purchase" | "order" | "batch" | "payment" | "productionPayment"; id: string };

export type SourceDocFile = {
  id: string;
  /** drive — DriveDocument (/api/drive-docs/<id>), purchase — PurchaseDocument (/api/purchase-docs/<id>). */
  src: "drive" | "purchase";
  title: string;
  /** Размер, имя файла и т. п. — одной короткой строкой. */
  meta: string;
  href: string;
  mime: string | null;
  /** Для drive: есть ли у записи ссылка на Drive (тогда «удалить файл» оставляет запись). */
  hasLink: boolean;
};

export type SourceDocRow = {
  key: string;
  label: string;
  docType: DriveDocTypeKey;
  number: string | null;
  /** yyyy-mm-dd или null. */
  date: string | null;
  /** Откуда известно, что документ нужен: «Закупка · поле «Номер УПД»». */
  origin: string;
  /** false — документ приложен, но в данных не упомянут («Прочее»). */
  expected: boolean;
  /** Загруженные файлы (есть оригинал в приложении). */
  files: SourceDocFile[];
  /** Запись документа без файла (ссылка на Drive есть, оригинала нет): файл «догружается» на неё. */
  linkId: string | null;
  target: SourceTarget;
  canUpload: boolean;
};

export type SourceDocsData = {
  rows: SourceDocRow[];
  /** Куда привязывается документ, загруженный «вообще» (кнопка внизу блока). */
  target: SourceTarget | null;
  canUpload: boolean;
  /** Сколько приложенных документов без файла в приложении не показано (только ссылки). */
  hiddenLinks: number;
};

/** Ссылка на документ, найденная в тексте. */
export type DocRef = { docType: DriveDocTypeKey; number: string | null; date: string | null; label: string };

const DATE = "(\\d{2})\\.(\\d{2})\\.(\\d{4})";
// Номер обязательно содержит цифру: «УПД в акте…» — не номер.
const NUM = "(?=[\\p{L}\\d\\-–/.]*\\d)[\\p{L}\\d][\\p{L}\\d\\-–/.]*";

function isoOf(d: string, m: string, y: string): string | null {
  const dt = new Date(Date.UTC(+y, +m - 1, +d));
  return dt.getUTCFullYear() === +y && dt.getUTCMonth() === +m - 1 && dt.getUTCDate() === +d ? `${y}-${m}-${d}` : null;
}

const ruDate = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : null);

export function refLabel(docType: DriveDocTypeKey, number: string | null, date: string | null): string {
  const name: Record<string, string> = {
    UPD: "УПД",
    AUCTION_INVOICE: "Счёт аукциона",
    PAYMENT_INVOICE: "Счёт",
    PAYMENT_PROOF: "Платёжка",
    SPECIFICATION: "Спецификация",
    TZ_APPENDIX: "Приложение к договору",
    CONTRACT: "Договор",
  };
  const base = name[docType] ?? docType;
  return `${base}${number ? ` №${number}` : ""}${date ? ` от ${ruDate(date)}` : ""}`;
}

/** Счёт аукциона и счёт на оплату — один и тот же вид документа при сопоставлении. */
export function typeGroup(t: DriveDocTypeKey | string): string {
  return t === "AUCTION_INVOICE" || t === "PAYMENT_INVOICE" ? "INVOICE" : t;
}

const normNum = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[\s№#]/g, "").replace(/^0+(?=\d)/, "");

/**
 * Разбор свободного текста (примечание закупки/партии, «основание» оплаты) на упоминания документов.
 * Только то, что в тексте названо явно: «УПД №170 от 30.09.2025», «Счёт №147», «п/п №36343 от 26.03.2025»,
 * «Спецификации №13», «Приложение №129», «Договор подряда № 1605 от 16.05.2025». Ничего не домысливает.
 */
export function extractDocRefs(text: string | null | undefined): DocRef[] {
  if (!text) return [];
  const t = text.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ");
  const out: DocRef[] = [];
  const add = (docType: DriveDocTypeKey, number: string | null, dateParts: string[] | null) => {
    const n = number ? number.replace(/[.,;:]+$/, "") : null;
    const date = dateParts ? isoOf(dateParts[0], dateParts[1], dateParts[2]) : null;
    if (!n && !date) return;
    out.push({ docType, number: n, date, label: refLabel(docType, n, date) });
  };
  const run = (rx: RegExp, docType: DriveDocTypeKey, numGroup = 1, dateGroup = 2) => {
    for (const m of t.matchAll(rx)) add(docType, m[numGroup] ?? null, m[dateGroup] ? [m[dateGroup], m[dateGroup + 1], m[dateGroup + 2]] : null);
  };
  const OT = `(?:\\s+от\\s+${DATE})?`;
  run(new RegExp(`п\\/п\\s*№?\\s*(\\d+)${OT}`, "giu"), "PAYMENT_PROOF");
  run(new RegExp(`сч[её]т(?:\\s+(?!№)[\\p{L}«»"]+)?\\s*№\\s*(${NUM})${OT}`, "giu"), "PAYMENT_INVOICE");
  run(new RegExp(`УПД\\s*(?:\\([^)]*\\)\\s*)?№?\\s*(${NUM})${OT}`, "gu"), "UPD");
  run(new RegExp(`спецификаци\\p{L}*\\s*№\\s*(\\d+)${OT}`, "giu"), "SPECIFICATION");
  run(new RegExp(`приложени\\p{L}*\\s*(?:к\\s+договору\\s*)?№\\s*(\\d+)${OT}`, "giu"), "TZ_APPENDIX");
  run(new RegExp(`договор\\p{L}*(?:\\s+подряда)?\\s*№\\s*(${NUM})${OT}`, "giu"), "CONTRACT");
  return dedupeRefs(out);
}

/** Поле «номер документа» (invoiceNumber, transferDocument…): «№ 124 от 29.07.2025 г.» или просто «5К7». */
export function refFromField(docType: DriveDocTypeKey, value: string | null | undefined): DocRef | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const m = new RegExp(`^№?\\s*(${NUM})(?:\\s+от\\s+${DATE})?`, "iu").exec(v);
  if (!m) return null;
  const date = m[2] ? isoOf(m[2], m[3], m[4]) : null;
  const number = m[1].replace(/[.,;:]+$/, "");
  return { docType, number, date, label: refLabel(docType, number, date) };
}

export const refKey = (r: DocRef) => `${typeGroup(r.docType)}|${normNum(r.number)}|${r.number ? "" : r.date ?? ""}`;

export function dedupeRefs(refs: DocRef[]): DocRef[] {
  const seen = new Set<string>();
  const out: DocRef[] = [];
  for (const r of refs) {
    const k = refKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/** Документ, приложенный в системе (из DriveDocument или PurchaseDocument) в виде, удобном для сопоставления. */
export type PoolDoc = {
  file: SourceDocFile | null; // null — записи без оригинала
  recordId: string; // DriveDocument.id (для догрузки файла) или PurchaseDocument.id
  src: "drive" | "purchase";
  docType: DriveDocTypeKey;
  number: string | null;
  date: string | null;
  title: string;
};

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Подходит ли приложенный документ под упомянутый: тот же вид, тот же номер (в поле или в названии), иначе — совпавшая дата. */
export function docMatchesRef(d: PoolDoc, r: DocRef): boolean {
  if (typeGroup(d.docType) !== typeGroup(r.docType)) return false;
  if (r.number) {
    const n = normNum(r.number);
    if (normNum(d.number) === n) return true;
    if (!d.number) return new RegExp(`(^|[^\\p{L}\\d])${escapeRx(r.number)}($|[^\\p{L}\\d])`, "iu").test(d.title);
    return false;
  }
  return !!r.date && d.date === r.date;
}

export type MatchResult = { ref: DocRef; matched: PoolDoc[] };

/** Сопоставление упомянутых документов с приложенными; возвращает также приложенные, которые ни под что не подошли. */
export function matchRefs(refs: DocRef[], pool: PoolDoc[]): { results: MatchResult[]; unclaimed: PoolDoc[] } {
  const claimed = new Set<PoolDoc>();
  const results = refs.map((ref) => {
    const matched = pool.filter((d) => docMatchesRef(d, ref));
    matched.forEach((d) => claimed.add(d));
    return { ref, matched };
  });
  return { results, unclaimed: pool.filter((d) => !claimed.has(d)) };
}

/** Сводка для строки-заголовка: «2 из 3 загружено». */
export function sourceDocsSummary(rows: Pick<SourceDocRow, "expected" | "files">[]): { total: number; loaded: number; extra: number } {
  const exp = rows.filter((r) => r.expected);
  return { total: exp.length, loaded: exp.filter((r) => r.files.length > 0).length, extra: rows.length - exp.length };
}
