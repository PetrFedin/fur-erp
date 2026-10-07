/**
 * Размер лота шкур из текста сорта (grade): единственное правило для аналитики и для поля RawMaterialLot.sizeGrade.
 * «Соболь баргузинский дикий сырец XXL 3 - 2.1» → «XXL»; «… сырец XXL,XL 3 - 2.1 SIL.2» → «XXL,XL» (диапазон как в документе).
 * Нет явного размера (S, M, L, XL, XXL, XXXL, XS отдельным словом) — null.
 */
export const SIZE_RE = /(?:^|[\s,(])((?:XXXL|XXL|XL|L|M|S|XS)(?:,(?:XXXL|XXL|XL|L|M|S|XS))*)(?=$|[\s,)])/i;

/**
 * Норка / лиса: размер шкурки — число после пола или «size» («норки американский жемчуг самец 40», «size 30», «самка 20/1»)
 * либо число в конце описания («Шкура норка белая, отбеленная 20», «серебристо-голубая 50 М», «браун 0 F»,
 * «лиса арктическая 40»). Формат подтверждён документами аукциона (SAGA: «… size 30», «… самец 40/30»).
 */
const FUR_SIZE_SEX_RE = /(?:самец|самка|size)\s+(\d{1,2}(?:\/\d{1,2})?)(?=$|[\s,)])/i;
const FUR_SIZE_TAIL_RE = /\s(\d{1,2})(?:\s*[МMF])?\s*$/i;
const NUMERIC_SIZE_MATERIAL_RE = /^(?:норка|лиса|лисица)/i;

/**
 * Размер как в тексте сорта («XXL» или «XXL,XL») либо null, если не распознан.
 * material (RawMaterial.name) нужен только для числовых размеров норки/лисы; без него разбираются буквенные (соболь).
 */
export function parseLotSizeGrade(grade: string | null | undefined, material?: string | null): string | null {
  const numeric = !!material && NUMERIC_SIZE_MATERIAL_RE.test(material.trim());
  // у норки/лисы одиночные «M»/«F» в SAGA-описаниях — пол (male/female: «MINK BROWN M REG XD…», «браун 0 F»), а не размер
  const m = numeric ? null : SIZE_RE.exec(grade ?? "");
  if (m) return m[1].toUpperCase();
  if (numeric) {
    const g = (grade ?? "").trim();
    const a = FUR_SIZE_SEX_RE.exec(g) ?? FUR_SIZE_TAIL_RE.exec(g);
    if (a) return a[1];
  }
  return null;
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

/**
 * Размеры лота ПО ДОКУМЕНТАМ: из RawMaterialLot.sizeGrade («XXL» / «XXL,XL» / «40/30»), без угадывания по тексту сорта.
 * Пусто (sizeGrade не заполнен) — размер в документах не указан. Лот с несколькими размерами попадает под каждый.
 */
export function lotSizes(sizeGrade: string | null | undefined): string[] {
  return Array.from(new Set((sizeGrade ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean)));
}
