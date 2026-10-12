// Конфликты написаний артикулов (код, SKU, код в продажах, синонимы): чистая функция без базы.
// То же правило, что в справочнике артикулов (settings/articles-ref): каждое написание принадлежит только одному артикулу.
import { articleKey, spellingsOf, type ArticleLite } from "@/lib/article-key";

export function articleConflict(list: ArticleLite[], exceptId: string | null, own: { name: string; sku?: string; salesCode?: string; aliases: string[] }): string | null {
  const taken = new Map<string, ArticleLite>();
  for (const a of list) {
    if (a.id === exceptId) continue;
    for (const sp of spellingsOf(a)) if (!taken.has(sp.key)) taken.set(sp.key, a);
  }
  const check = (label: string, text: string) => {
    const k = articleKey(text);
    if (!k) return null;
    const o = taken.get(k);
    return o ? `${label} «${text}» уже записан у артикула ${o.name}` : null;
  };
  return (
    check("Код артикула", own.name) ??
    (own.sku ? check("SKU", own.sku) : null) ??
    (own.salesCode ? check("Код в продажах", own.salesCode) : null) ??
    own.aliases.map((a) => check("Другое написание", a)).find(Boolean) ??
    null
  );
}
