// № счёта и № п/п оплаты: отдельные поля (Payment/ProductionPayment.invoiceNo, ppNo) и читаемая строка docRef (совместимость).
// Чистые функции без базы: можно импортировать и в клиентском коде.

export const PP_RX = /п\/п\s*№?\s*(\d+)(?:\s+от\s+(\d{2}\.\d{2}\.\d{4}))?/i;
export const INV_RX = /сч[её]т[^№;·]*№\s*([^\s;·,()]+)(?:\s+от\s+(\d{2}\.\d{2}\.\d{4}))?/i;

export type ParsedRef = { ppNo: string | null; ppDate: string | null; invoiceNo: string | null; invoiceDate: string | null };

/** Старый разбор docRef «п/п № 123 от 01.02.2026, счёт № 45». Только то, что названо однозначно. */
export function parseDocRef(docRef: string | null | undefined): ParsedRef {
  const t = docRef ?? "";
  const pp = PP_RX.exec(t);
  const inv = INV_RX.exec(t);
  return { ppNo: pp?.[1] ?? null, ppDate: pp?.[2] ?? null, invoiceNo: inv?.[1] ?? null, invoiceDate: inv?.[2] ?? null };
}

/** «№ 12», «счёт №12», «п/п 12» → «12». */
export function cleanRefNo(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/^\s*(?:сч[её]т\p{L}*|п\/п)?\s*№?\s*/iu, "")
    .trim()
    .slice(0, 40);
}

const ruFromIso = (iso: string) => iso.split("-").reverse().join(".");

/**
 * Новая строка docRef после правки № п/п, № счёта и/или даты: заменяем найденные фрагменты на месте,
 * остальной текст основания сохраняем; если фрагмента не было — дописываем в конец.
 */
export function rebuildDocRef(old: string | null | undefined, next: { ppNo: string; invoiceNo: string; paidIso: string }): string | null {
  let s = (old ?? "").trim();
  const prev = parseDocRef(s);
  const date = ruFromIso(next.paidIso);
  if (next.ppNo) {
    const frag = `п/п № ${next.ppNo} от ${date}`;
    const m = PP_RX.exec(s);
    s = m ? s.replace(m[0], frag) : s ? `${frag}, ${s}` : frag;
  } else {
    const m = PP_RX.exec(s);
    if (m) s = s.replace(m[0], "").replace(/^[\s,;·]+|[\s,;·]+$/g, "");
  }
  if (next.invoiceNo) {
    const keepDate = prev.invoiceNo === next.invoiceNo && prev.invoiceDate ? ` от ${prev.invoiceDate}` : "";
    const frag = `счёт № ${next.invoiceNo}${keepDate}`;
    const m = INV_RX.exec(s);
    s = m ? s.replace(m[0], frag) : s ? `${s}, ${frag}` : frag;
  } else {
    const m = INV_RX.exec(s);
    if (m) s = s.replace(m[0], "").replace(/^[\s,;·]+|[\s,;·]+$/g, "");
  }
  s = s.replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").trim();
  return s ? s.slice(0, 200) : null;
}

/** Поля для записи в базу из свободной строки docRef: берём только то, что разобралось однозначно (иначе поле не трогаем — null). */
export function refFields(docRef: string | null | undefined): { invoiceNo: string | null; ppNo: string | null } {
  const p = parseDocRef(docRef);
  return { invoiceNo: p.invoiceNo, ppNo: p.ppNo };
}
