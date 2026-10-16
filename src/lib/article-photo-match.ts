// Чистая логика сопоставления строк выгрузки магазина с нашими артикулами и разбора кодов PLU (HE…). Без БД и без сети.
import { normalizeModelCode } from "./model-code";

/** «M001A/SABLE  wild» -> «M001A/SABLE WILD»: кириллица -> латиница, один пробел, верхний регистр. */
export const normArticle = (s: string) => normalizeModelCode(String(s ?? "")).replace(/\s+/g, " ").trim().toUpperCase();

/** PLU: «НЕ00924905» (кириллица) / «he00924905 » -> «HE00924905»; всё, что не HE + цифры, — null. */
export function normalizePlu(raw: unknown): string | null {
  const s = normalizeModelCode(String(raw ?? "")).replace(/\s+/g, "").toUpperCase();
  return /^HE\d{5,}$/.test(s) ? s : null;
}

/** Код артикула в начале строки: «M001A/…», «MGL-01 …», «MH-08». */
export function leadingCode(article: string): { code: string; variant: string } | null {
  const m = /^([A-Z]{1,4}-?\d+[A-Z]?)(?=$|[\s/])/.exec(normArticle(article));
  if (!m) return null;
  const rest = normArticle(article).slice(m[1].length).replace(/^[\s/]+/, "");
  return { code: m[1], variant: rest };
}

export type MatchModel = { id: string; name: string; salesCode: string | null; aliases: string[] };
export type MatchResult =
  | { ok: true; modelId: string; variant: string; by: "alias" | "code" }
  | { ok: false; reason: string };

export function matchArticle(article: string, models: MatchModel[]): MatchResult {
  const a = normArticle(article);
  const lc = leadingCode(a);
  if (!lc) return { ok: false, reason: "код артикула не распознан" };
  const byAlias = models.filter((m) => m.aliases.some((x) => normArticle(x) === a));
  if (byAlias.length > 1) return { ok: false, reason: `строка есть у нескольких артикулов: ${byAlias.map((m) => m.name).join(", ")}` };
  const byCode = models.filter((m) => (m.salesCode && normArticle(m.salesCode) === lc.code) || normArticle(m.name) === lc.code);
  if (byCode.length > 1) return { ok: false, reason: `код ${lc.code} у нескольких артикулов` };
  if (byAlias.length === 1) {
    if (byCode.length === 1 && byCode[0].id !== byAlias[0].id) return { ok: false, reason: "псевдоним и код указывают на разные артикулы" };
    return { ok: true, modelId: byAlias[0].id, variant: lc.variant, by: "alias" };
  }
  if (byCode.length === 1) return { ok: true, modelId: byCode[0].id, variant: lc.variant, by: "code" };
  return { ok: false, reason: `артикула ${lc.code} нет в базе` };
}

/** Имя параметра для PLU: «PLU», либо «PLU <вариант>», если у артикула PLU по нескольким вариантам (≤ 40 знаков). */
export function pluParamName(variant: string, multi: boolean): string {
  const v = variant.trim();
  if (!multi || !v) return "PLU";
  return `PLU ${v}`.slice(0, 40).trim();
}

/** Параметр — PLU (для поиска и показа). */
export const isPluParam = (name: string) => /^PLU(\s|$)/i.test(name);

/** Артикулы, у которых PLU содержит запрос (кириллическое «НЕ…» понимается как «HE…»; минимум 4 знака, чтобы «HE» не находило всё). */
export function pluMatchIds(all: Map<string, { name: string; value: string }[]>, q: string): string[] {
  const needle = normalizeModelCode(q).replace(/\s+/g, "").toUpperCase();
  if (needle.length < 4) return [];
  return Array.from(all).filter(([, list]) => list.some((p) => isPluParam(p.name) && normalizeModelCode(p.value).replace(/\s+/g, "").toUpperCase().includes(needle))).map(([id]) => id);
}
