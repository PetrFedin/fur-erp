/** Название партии для подписи рядом с «Партия N»: служебное «Поставка N» / «Партия N» (то же, что номер) не показываем. */
export function batchNameText(name: string | null | undefined): string | null {
  const n = (name ?? "").trim();
  return n && !/^(поставка|партия)\s*№?\s*\d+$/i.test(n) ? n : null;
}
