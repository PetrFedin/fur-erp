// Даты аукционов в календаре. Хранение без миграции: строка CalendarEvent с supplierId и action = «Аукцион».
// Поля: articleCode — название («СП 09-26»), articleName — аукционный дом, color — место, notes — комментарий,
// docNote = "plan" — «планируем участвовать», quantity = 0, status = "auction". Статус «прошёл / запланирован» считается по дате.
export const AUCTION_ACTION = "Аукцион";
export const AUCTION_STATUS = "auction";
export const AUCTION_PLAN_FLAG = "plan";

export type AuctionMark = { id: string; name: string; house: string; place: string; date: string; notes: string; participate: boolean };

/** Строка CalendarEvent → отметка аукциона. */
export function toAuctionMark(e: { id: string; articleCode: string; articleName: string | null; color: string | null; date: Date; notes: string | null; docNote: string | null }): AuctionMark {
  return { id: e.id, name: e.articleCode, house: e.articleName ?? "", place: e.color ?? "", date: e.date.toISOString().slice(0, 10), notes: e.notes ?? "", participate: e.docNote === AUCTION_PLAN_FLAG };
}

export const isPastAuction = (date: string, today: string) => date < today;
export const auctionStatus = (date: string, today: string) => (isPastAuction(date, today) ? "прошёл" : "запланирован");

/** «СП 09-26 · Союзпушнина · Санкт-Петербург». */
export function auctionTitle(a: { name: string; house?: string; place?: string }) {
  return [a.name, a.house && !a.name.toLowerCase().includes(a.house.toLowerCase()) ? a.house : "", a.place].filter(Boolean).join(" · ");
}
export const normName = (s: string) => s.toLowerCase().replace(/[\s.\-_]+/g, "");
