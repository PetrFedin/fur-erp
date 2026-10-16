// Редактор «Магазин и фото»: чистая логика без БД и без файлов (проверяется в scripts/test-article-photos.ts).
// PLU и ссылка хранятся там же, где и раньше: PLU — свойство артикула «PLU» / «PLU <вариант>», ссылка — SystemState `article-shop-links:<id>`.
import { normalizeModelCode } from "./model-code";
import { isPluParam, pluParamName } from "./article-photo-match";

export const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
export const PHOTOS_PER_ARTICLE_MAX = 60;
export const URL_MAX = 500;
export const PLU_TOKEN_MAX = 40;
export const PLU_VALUE_MAX = 120; // как у значения свойства артикула
export const VARIANTS_MAX = 30;

/** Один PLU: кириллические Н/Е/… -> латиница, пробелы убраны, верхний регистр. Пустое и странное — null. */
export function normalizePluToken(raw: unknown): string | null {
  const s = normalizeModelCode(String(raw ?? "")).replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9][A-Z0-9._\/-]{1,39}$/.test(s) ? s : null;
}

/** Список PLU через запятую/точку с запятой/перенос. Возвращает нормализованный список без повторов либо ошибку. */
export function parsePluList(raw: unknown): { plus: string[] } | { error: string } {
  const parts = String(raw ?? "").split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const n = normalizePluToken(p);
    if (!n) return { error: `PLU «${p.slice(0, 20)}» не подходит: буквы, цифры, - _ . /, 2–${PLU_TOKEN_MAX} знаков` };
    if (!out.includes(n)) out.push(n);
  }
  if (out.join(", ").length > PLU_VALUE_MAX) return { error: `PLU длиннее ${PLU_VALUE_MAX} знаков` };
  return { plus: out };
}

/** Ссылка на товар: только http/https, без логина и пароля, ≤500 знаков. Пусто — ссылки нет. */
export function validateShopUrl(raw: unknown): { url: string } | { error: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { url: "" };
  if (s.length > URL_MAX) return { error: `Ссылка длиннее ${URL_MAX} знаков` };
  if (/[\u0000-\u001f\u007f\s]/.test(s)) return { error: "В ссылке не должно быть пробелов" };
  let u: URL;
  try { u = new URL(s); } catch { return { error: "Ссылка не распознана: начните с https://" }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "Ссылка должна начинаться с https:// или http://" };
  if (u.username || u.password) return { error: "В ссылке не должно быть логина и пароля" };
  if (!u.hostname.includes(".")) return { error: "В ссылке нет адреса сайта" };
  return { url: u.toString() };
}

/** Безопасная ссылка для показа и записи: прошла validateShopUrl и не пустая. */
export const isSafeShopUrl = (v: unknown): v is string => { if (typeof v !== "string" || !v) return false; const r = validateShopUrl(v); return "url" in r && r.url !== ""; };

export type PluParam = { name: string; value: string };

/**
 * Свойства «PLU…» артикула -> PLU по вариантам. «PLU <вариант>» — вариант назван в имени; общее «PLU» относится к варианту,
 * у которого есть ссылка с таким же PLU (itemId страницы), иначе к первому из известных вариантов (или к пустому — «Цвет не определён»).
 */
export function pluByVariant(params: PluParam[], variants: string[], linkPlu: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  const lower = (s: string) => s.toLowerCase();
  for (const p of params) {
    if (!isPluParam(p.name)) continue;
    const tail = p.name.slice(3).trim();
    let v: string | undefined;
    if (tail) v = variants.find((x) => lower(pluParamName(x, true)) === lower(p.name)) ?? tail;
    else {
      const first = p.value.split(/\s*,\s*/)[0]?.toUpperCase().replace(/\s+/g, "");
      v = [...linkPlu].find(([, plu]) => plu === first)?.[0] ?? variants[0] ?? "";
    }
    out.set(v, out.has(v) ? `${out.get(v)}, ${p.value}` : p.value);
  }
  return out;
}

/** Свойства «PLU…» по введённым PLU вариантов: один вариант с PLU — «PLU», несколько — «PLU <вариант>». */
export function buildPluParams(byVariant: { variant: string; plus: string[] }[]): PluParam[] | { error: string } {
  const filled = byVariant.filter((x) => x.plus.length);
  const multi = filled.length > 1;
  const out: PluParam[] = [];
  for (const x of filled) {
    const name = pluParamName(x.variant, multi);
    if (out.some((o) => o.name.toLowerCase() === name.toLowerCase())) return { error: "Цвета называются слишком похоже: PLU нельзя разнести. Переименуйте один." };
    out.push({ name, value: x.plus.join(", ") });
  }
  return out;
}

/** Повторы PLU внутри одного артикула (в разных цветах). */
export function dupWithin(byVariant: { variant: string; plus: string[] }[]): string[] {
  const seen = new Set<string>(), dup = new Set<string>();
  for (const x of byVariant) for (const p of x.plus) { if (seen.has(p)) dup.add(p); seen.add(p); }
  return [...dup];
}

/** PLU, уже занятые другими артикулами: [{ plu, article }] (по свойствам «PLU…»). */
export function pluTakenBy(all: Map<string, PluParam[]>, names: Map<string, string>, selfId: string, plus: string[]): { plu: string; article: string }[] {
  const want = new Set(plus);
  const out: { plu: string; article: string }[] = [];
  for (const [id, list] of all) {
    if (id === selfId) continue;
    for (const p of list) {
      if (!isPluParam(p.name)) continue;
      for (const t of p.value.split(/[,;]+/)) {
        const n = normalizePluToken(t);
        if (n && want.has(n) && !out.some((o) => o.plu === n && o.article === (names.get(id) ?? id))) out.push({ plu: n, article: names.get(id) ?? id });
      }
    }
  }
  return out;
}

export const photoDirOk = (rel: string, orgId: string, modelId: string) =>
  rel.startsWith(["article-photos", orgId, modelId].join("/") + "/") && !rel.includes("..") && !rel.includes("\0");
