// Цвета фото артикула: группировка по варианту (цвету) из файла владельца и понятное русское название цвета. Чистые функции, без БД.
// Одна страница магазина = один товар = один цвет (проверено по данным страниц: у всех 108 страниц один цвет и свой набор фото),
// поэтому фото попадают в группу варианта той строки файла, по которой найдена ссылка; чужих цветов внутри варианта нет.
import { matchColorRef, type ColorRefLite } from "./color-ref";

/** Сокращения цветов в вариантах из файла -> слово, которое понимает справочник цветов (ColorRef). */
const ABBR: Record<string, string> = { BGL: "BLACK GLAMA", LVD: "LAVENDER", PST: "PASTEL", TORTOR: "TORTORA", FONDU: "FONDU", VIOLET: "ВИОЛЕТ" };

/** Название цвета по варианту «MINK BGL», «SWAKARA NOUGAT», «MINK BROWN+CASHMERE»: ищем слово/пару слов в справочнике цветов, слева направо. */
export function variantColorName(variant: string, refs: ColorRefLite[]): string | null {
  const words = variant.toUpperCase().split(/[\s+/]+/).filter(Boolean).map((w) => ABBR[w] ?? w);
  for (let i = 0; i < words.length; i++) {
    for (const len of [2, 1]) {
      if (i + len > words.length) continue;
      const ref = matchColorRef(words.slice(i, i + len).join(" "), refs);
      if (ref) return ref.name;
    }
  }
  return null;
}

export type PhotoLike = { id: string; variant: string; color?: string; itemId?: string };
export type ColorGroup<P extends PhotoLike> = { key: string; label: string; photos: P[]; undetermined: boolean };

/**
 * Группы по цветам. Подпись: название из нашего справочника; если по варианту его не найти — цвет со страницы магазина (запасной);
 * нет и его — «Цвет не определён» (такая группа всегда последняя). Одинаковые подписи у разных вариантов различаются вариантом.
 * Порядок групп — по первому фото; один цвет — одна группа (переключатель не нужен).
 */
export function groupPhotosByColor<P extends PhotoLike>(photos: P[], refs: ColorRefLite[]): ColorGroup<P>[] {
  const by = new Map<string, P[]>();
  for (const p of photos) (by.get(p.variant) ?? by.set(p.variant, []).get(p.variant)!).push(p);
  const raw = [...by].map(([key, list]) => {
    const ours = key ? variantColorName(key, refs) : null;
    const site = list.find((p) => p.color)?.color ?? null;
    return { key, photos: list, name: ours ?? site, undetermined: !ours && !site };
  });
  const count = new Map<string, number>();
  for (const g of raw) if (g.name) count.set(g.name, (count.get(g.name) ?? 0) + 1);
  const groups: ColorGroup<P>[] = raw.map((g) => ({
    key: g.key, photos: g.photos, undetermined: g.undetermined,
    label: g.name ? ((count.get(g.name) ?? 0) > 1 && g.key ? `${g.name} · ${g.key}` : g.name) : "Цвет не определён",
  }));
  return [...groups.filter((g) => !g.undetermined), ...groups.filter((g) => g.undetermined)];
}

/** Код PLU страницы магазина (HE + цифры), если код страницы — PLU; числовые коды (7130192) PLU не считаются. */
export const pluOfItem = (itemId: string): string | null => (/^HE\d{5,}$/i.test(itemId) ? itemId.toUpperCase() : null);

/** Данные для окна «Фото»: группы-вкладки и (только заказчику) страницы магазина по коду страницы: ссылка и PLU. */
export function galleryExtras(photos: PhotoLike[], links: { itemId: string; url: string; variant?: string }[] | null, refs: ColorRefLite[]) {
  const groups = groupPhotosByColor(photos, refs).map((g) => ({ key: g.key, label: g.label }));
  if (!links) return { groups };
  const shops: Record<string, { url: string; plu: string | null }> = {};
  for (const l of links) {
    if (l.itemId) shops[l.itemId.toUpperCase()] = { url: l.url, plu: pluOfItem(l.itemId) };
    // Ссылка, внесённая вручную (без кода страницы), привязана к цвету-варианту: ключ «v:<вариант>» (первая ссылка варианта).
    else if (typeof l.variant === "string" && !(("v:" + l.variant) in shops)) shops["v:" + l.variant] = { url: l.url, plu: null };
  }
  return { groups, shops };
}
