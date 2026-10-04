/**
 * Размер лота шкур из текста сорта (grade): единственное правило для аналитики и для поля RawMaterialLot.sizeGrade.
 * «Соболь баргузинский дикий сырец XXL 3 - 2.1» → «XXL»; «… сырец XXL,XL 3 - 2.1 SIL.2» → «XXL,XL» (диапазон как в документе).
 * Нет явного размера (S, M, L, XL, XXL, XXXL, XS отдельным словом) — null.
 */
export const SIZE_RE = /(?:^|[\s,(])((?:XXXL|XXL|XL|L|M|S|XS)(?:,(?:XXXL|XXL|XL|L|M|S|XS))*)(?=$|[\s,)])/i;

/** Размер как в тексте сорта («XXL» или «XXL,XL») либо null, если не распознан. */
export function parseLotSizeGrade(grade: string | null | undefined): string | null {
  const m = SIZE_RE.exec(grade ?? "");
  return m ? m[1].toUpperCase() : null;
}

/** Основной (первый) размер для группировок аналитики: «XXL,XL» → «XXL». Нет — «Не указан». */
export function sizeOf(grade: string | null | undefined): string {
  const s = parseLotSizeGrade(grade);
  return s ? s.split(",")[0] : "Не указан";
}

/** Сорт/цвет без хвоста с размером: «Соболь баргузинский дикий сырец XXL 3 - 2.1» → «Соболь баргузинский дикий сырец». */
export function categoryOf(grade: string | null | undefined, color: string | null | undefined): string {
  const g = (grade ?? "").trim();
  const m = SIZE_RE.exec(g);
  const base = (m ? g.slice(0, m.index) : g).trim().replace(/[\s,;-]+$/, "");
  const c = (color ?? "").trim();
  if (base && c) return `${base}, ${c}`;
  return base || c || "Не указано";
}
