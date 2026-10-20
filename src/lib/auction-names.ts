// Отображение названий аукционов. Только для показа: данные в БД и ключи фильтров
// (Purchase.auctionSession, ?auction=) всегда остаются полными названиями.

/** Максимальная длина названия в списках и чипах. */
export const AUCTION_NAME_MAX = 40;

/** Служебные «аукционы» — заглушки импорта, а не реальные торги; показываются отдельно, в группе «Прочее». */
const SERVICE_PREFIXES = ["нет информации", "не в реестре остатков", "подкладочные материалы", "доп закупк", "без аукциона"];

/** Как показываем служебные метки («Нет информации», «Не в реестре остатков…» и т. п.). */
export const NO_AUCTION_LABEL = "Без аукциона";

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase().replace(/ё/g, "е");

export function isServiceAuction(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = norm(name);
  return SERVICE_PREFIXES.some((p) => n.startsWith(p));
}

/**
 * Короткое читаемое название: «ООО «Веллмех» СПЕЦИФИКАЦИЯ № 18 от 01 июля 2026 г. к Договору…» -> «Спецификация № 18»;
 * остальные длинные названия обрезаются по слову до ~40 символов с многоточием. Полное название — в title.
 */
export function shortAuctionName(name: string | null | undefined, max = AUCTION_NAME_MAX): string {
  const clean = (name ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (isServiceAuction(clean)) return NO_AUCTION_LABEL;
  const spec = /спецификаци[яи]\s*(?:№|N|No\.?)\s*([0-9A-Za-zА-Яа-я][0-9A-Za-zА-Яа-я./-]*)/i.exec(clean);
  if (spec && clean.length > max) return `Спецификация № ${spec[1].replace(/[.,;]+$/, "")}`;
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

/**
 * Единый формат даты в названии: «СП 03-25» -> «СП 03.25» (так называет аукционы справочник). Старое и новое написание
 * получают один ключ группировки, поэтому суммы и долги не зависят от того, переименованы ли записи.
 */
export function canonicalAuctionDate(raw: string): string {
  return raw.replace(/^(\D*?\s\d{2})[-.](\d{2})$/, "$1.$2");
}

/** Любой текст с названием аукциона («СП 09-26 · счёт 3017») → даты «мм.гг» через точку, как у владельца. Номера счетов (0022-001, 1015-002) не затрагиваются. */
export function dotAuctionDates(text: string | null | undefined): string {
  return (text ?? "").replace(/(\s|^)(\d{2})-(\d{2})(?=\s|$|[·,;)])/g, "$1$2.$3");
}

/**
 * Название аукциона (партии закупки) из Purchase.auctionSession: первая строка, служебные метки импорта — null
 * («Без аукциона»), даты в формате «мм.гг». Без server-only — годится и для скриптов. Названия, не похожие на «<дом> мм-гг»
 * («Закупка меха 04-26»), здесь не меняются: их сопоставление с короткими именами — в справочнике аукционов
 * (findAuctionIn по имени/алиасу) и в scripts/apply-auction-names.ts.
 */
export function auctionName(session: string | null | undefined): string | null {
  const raw = session?.split(/\r?\n/)[0].trim();
  if (!raw) return null;
  // Служебная метка импорта — не аукцион. Такие закупки показываем как «Без аукциона».
  if (/^нет информации$/i.test(raw) || /^не в реестре остатков/i.test(raw) || /^без аукциона$/i.test(raw)) return null;
  return canonicalAuctionDate(raw);
}
