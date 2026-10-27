// Единая подпись артикула по справочнику (ProductModel): «M012 · Пальто» / компактно «M012».
// Код — ProductModel.name (наш код, M…/М…); название — тип изделия (category) либо, если типа нет, короткое название из
// системы продаж (salesName). Код и название в системе продаж (salesCode/salesName) идут в подсказку — articleHint().
// Данные ProductModel не меняются: только показ. Поиск по любому написанию — article-key.ts / article-ref.ts.
// Чистые функции без базы: годятся и для сервера, и для клиента, и для печати/docx.

export type ArticleLike = {
  name: string;
  sku?: string | null;
  category?: string | null;
  salesCode?: string | null;
  salesName?: string | null;
};

const MAX_TITLE = 40;
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

function cut(s: string, max = MAX_TITLE): string {
  if (s.length <= max) return s;
  const c = s.slice(0, max - 1);
  const sp = c.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? c.slice(0, sp) : c).replace(/[\s,;:.-]+$/, "")}…`;
}

/** Название артикула без кода: тип изделия, иначе начало названия из системы продаж. Пусто, если ничего нет. */
export function articleTitle(m: ArticleLike): string {
  return cut(clean(m.category) || clean(m.salesName));
}

/** «M012 · Пальто»; compact — только код «M012». Если названия нет — просто код. */
export function articleLabel(m: ArticleLike | null | undefined, opts: { compact?: boolean } = {}): string {
  if (!m) return "–";
  const code = clean(m.name);
  if (opts.compact) return code;
  const t = articleTitle(m);
  return t && t.toLowerCase() !== code.toLowerCase() ? `${code} · ${t}` : code;
}

/** Подсказка (title): код и название в нашей базе + код и название в системе продаж. */
export function articleHint(m: ArticleLike | null | undefined): string {
  if (!m) return "";
  const lines = [articleLabel(m)];
  const sc = clean(m.salesCode);
  const sn = clean(m.salesName);
  if (sc && sc !== clean(m.name)) lines.push(`Код в продажах: ${sc}`);
  if (sn) lines.push(sn);
  if (clean(m.sku)) lines.push(`SKU: ${clean(m.sku)}`);
  return lines.join("\n");
}
