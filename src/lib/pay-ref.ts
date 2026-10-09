/**
 * Основание платежа для показа: убираем то, что уже есть в строке рядом — дату платежа («от 28.05.2026»,
 * когда она совпадает с датой оплаты) и служебную приписку «(акт сверки на 30.06.2026)»; части разделяем « · ».
 * В базе строка не меняется.
 */
export function tidyDocRef(docRef: string | null | undefined, dateText?: string | null): string {
  let s = (docRef ?? "").trim();
  if (!s) return "";
  s = s.replace(/\s*\((?:акт сверки|по акту)[^)]*\)/gi, "");
  if (dateText) s = s.replace(new RegExp(`\\s+от\\s+${dateText.replace(/\./g, "\\.")}`, "g"), "");
  return s.split(/\s*;\s*/).map((x) => x.trim()).filter(Boolean).join(" · ");
}
