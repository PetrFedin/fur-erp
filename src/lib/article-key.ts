/**
 * Справочник артикулов: чистые функции (без базы) — их используют серверный поиск (article-ref.ts),
 * компонент ArticleSelect и страница /settings/articles-ref.
 *
 * Запись справочника = ProductModel: name (наш код, M…/М…), sku, category (название/описание),
 * salesCode/salesName (код и название в системе продаж), aliases (прочие написания).
 * Сравнение — по ключу articleKey: регистр, пробелы, дефисы и слэши не важны, кириллица-двойники латиницы
 * («М012» = «M012») сводятся к одному написанию.
 */
import { normalizeModelCode } from "@/lib/model-code";

export type ArticleLite = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  salesCode: string | null;
  salesName: string | null;
  aliases: string[];
  isActive: boolean;
};

export function articleKey(s: string | null | undefined): string {
  return normalizeModelCode(s ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-z0-9а-я]/g, "");
}

/** «M012/MINK BGL» → «M012»; «MH-02 MINK BGL» → «MH-02»: код без ткани/цвета. */
export function articleBase(s: string | null | undefined): string {
  const t = (s ?? "").trim();
  const slash = t.indexOf("/");
  const head = slash > 0 ? t.slice(0, slash) : t.split(/\s+/)[0] ?? "";
  return head.trim();
}

export type SpellingKind = "name" | "sku" | "sales" | "alias";
export const SPELLING_LABEL: Record<SpellingKind, string> = {
  name: "наш код",
  sku: "наш SKU",
  sales: "код в продажах",
  alias: "другое написание",
};
const RANK: Record<SpellingKind, number> = { name: 0, sku: 1, sales: 2, alias: 3 };

export type Spelling = { key: string; text: string; kind: SpellingKind };

/** Все «написания» артикула, по которым его можно найти. Пустые ключи отброшены. */
export function spellingsOf(a: ArticleLite): Spelling[] {
  const out: Spelling[] = [];
  const push = (text: string | null | undefined, kind: SpellingKind) => {
    const t = (text ?? "").trim();
    const key = articleKey(t);
    if (key) out.push({ key, text: t, kind });
  };
  push(a.name, "name");
  push(a.sku, "sku");
  push(a.salesCode, "sales");
  for (const al of a.aliases) push(al, "alias");
  return out;
}

export type ArticleHit = { article: ArticleLite; score: number; via: Spelling | null };

/** Поиск по любому написанию (и по названию/описанию). Лучшие — выше; неактивные — в конце при равенстве. */
export function searchArticleList(list: ArticleLite[], q: string, limit = 30): ArticleHit[] {
  const qk = articleKey(q);
  const qt = (q ?? "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  if (!qk && !qt) return [];
  const hits: ArticleHit[] = [];
  for (const a of list) {
    let best = 0;
    let via: Spelling | null = null;
    if (qk) {
      for (const sp of spellingsOf(a)) {
        let s = 0;
        if (sp.key === qk) s = 100 - RANK[sp.kind] * 5;
        else if (sp.key.startsWith(qk)) s = 70 - RANK[sp.kind] * 3;
        else if (qk.length >= 2 && sp.key.includes(qk)) s = 50 - RANK[sp.kind] * 3;
        if (s > best) {
          best = s;
          via = sp;
        }
      }
    }
    if (best === 0 && qt.length >= 3) {
      const text = `${a.category ?? ""} ${a.salesName ?? ""}`.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
      if (text.includes(qt)) best = 20;
    }
    if (best > 0) hits.push({ article: a, score: best - (a.isActive ? 0 : 1), via });
  }
  hits.sort((x, y) => y.score - x.score || x.article.name.localeCompare(y.article.name, "ru", { numeric: true }));
  return hits.slice(0, limit);
}

/**
 * Однозначное разрешение: текст точно совпадает с одним из написаний ровно одного артикула.
 * Нет совпадения или их несколько (неоднозначно) — null. Если полного совпадения нет, а в тексте есть ткань/цвет
 * («M012/MINK BGL»), пробуем код до слэша/пробела.
 */
export function resolveFromList(list: ArticleLite[], input: string): ArticleLite | null {
  const c = candidatesFromList(list, input);
  return c.length === 1 ? c[0] : null;
}

/** Все артикулы, у которых лучшее точное совпадение с текстом (для показа неоднозначности). */
export function candidatesFromList(list: ArticleLite[], input: string): ArticleLite[] {
  const tryKey = (k: string) => {
    if (!k) return [] as ArticleLite[];
    let bestRank = 99;
    let found: ArticleLite[] = [];
    for (const a of list) {
      let r = 99;
      for (const sp of spellingsOf(a)) if (sp.key === k) r = Math.min(r, RANK[sp.kind]);
      if (r === 99) continue;
      if (r < bestRank) {
        bestRank = r;
        found = [a];
      } else if (r === bestRank) found.push(a);
    }
    return found;
  };
  const full = tryKey(articleKey(input));
  if (full.length > 0) return full;
  const base = articleBase(input);
  if (base && articleKey(base) !== articleKey(input)) return tryKey(articleKey(base));
  return [];
}

/** Строка «в продажах: …» для подписи в списках выбора. */
export function salesLabel(a: ArticleLite): string {
  const parts = [a.salesCode, a.salesName].filter((x) => x && x.trim());
  return parts.join(" — ");
}

/** Список alias-ов из строки «через запятую / точку с запятой / перенос». */
export function parseAliases(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of (raw ?? "").split(/[;,\n]+/)) {
    const t = p.trim().replace(/\s+/g, " ");
    if (!t || t.length > 120) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}
